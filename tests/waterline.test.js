import test from "node:test";
import assert from "node:assert/strict";
import { defaultConfig } from "../src/defaults.js";
import { createLogger } from "../src/logger.js";
import { WaterlineManager, findNewTail } from "../src/waterline.js";

const quietLogger = {
  info() {},
  warn() {},
  error() {},
  token() {
    return false;
  }
};

test("normal append flow keeps prior messages and appends only the new tail", () => {
  const manager = new WaterlineManager(defaultConfig, quietLogger);
  const identity = mainIdentity("main-session");

  const first = manager.build(
    {
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "one" }
      ]
    },
    identity
  );

  assert.equal(first.body.messages.length, 2);

  const second = manager.build(
    {
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "one" },
        { role: "assistant", content: "two" },
        { role: "user", content: "three" }
      ]
    },
    identity
  );

  assert.deepEqual(
    second.body.messages.map((message) => message.content),
    ["You are helpful.", "one", "two", "three"]
  );
  assert.equal(second.stats.added, 2);
});

test("agent compaction does not replace the internal album", () => {
  const manager = new WaterlineManager(defaultConfig, quietLogger);
  const identity = mainIdentity("main-session");

  const longBody = [{ role: "system", content: "s" }];
  for (let index = 0; index < 20; index += 1) {
    longBody.push({ role: index % 2 ? "assistant" : "user", content: `m${index}` });
  }

  manager.build({ messages: longBody }, identity);
  const compacted = manager.build(
    {
      messages: [
        { role: "system", content: "s" },
        { role: "assistant", content: "summary from agent" },
        { role: "assistant", content: "m19" },
        { role: "user", content: "new question" }
      ]
    },
    identity
  );

  assert.equal(compacted.stats.compaction, true);
  assert.equal(
    compacted.body.messages.some((message) => message.content === "summary from agent"),
    false
  );
  assert.equal(compacted.body.messages.at(-1).content, "new question");
});

test("explicit session change resets MAIN state", () => {
  const manager = new WaterlineManager(defaultConfig, quietLogger);

  manager.build({ messages: [{ role: "user", content: "old" }] }, mainIdentity("a"));
  const next = manager.build({ messages: [{ role: "user", content: "new" }] }, mainIdentity("b"));

  assert.deepEqual(
    next.body.messages.map((message) => message.content),
    ["new"]
  );
});

test("short fresh user-only request resets without explicit session headers", () => {
  const manager = new WaterlineManager(defaultConfig, quietLogger);
  const identity = {
    ...mainIdentity("anonymous-main"),
    hasExplicitSession: false
  };

  const longBody = [{ role: "system", content: "same system" }];
  for (let index = 0; index < 18; index += 1) {
    longBody.push({ role: index % 2 ? "assistant" : "user", content: `old ${index}` });
  }

  manager.build({ messages: longBody }, identity);
  const next = manager.build(
    {
      messages: [
        { role: "system", content: "same system" },
        { role: "user", content: "fresh new window" }
      ]
    },
    identity
  );

  assert.deepEqual(
    next.body.messages.map((message) => message.content),
    ["same system", "fresh new window"]
  );
});

test("short summary-shaped compaction does not reset without explicit session headers", () => {
  const manager = new WaterlineManager(defaultConfig, quietLogger);
  const identity = {
    ...mainIdentity("anonymous-main"),
    hasExplicitSession: false
  };

  const longBody = [{ role: "system", content: "same system" }];
  for (let index = 0; index < 18; index += 1) {
    longBody.push({ role: index % 2 ? "assistant" : "user", content: `old ${index}` });
  }

  manager.build({ messages: longBody }, identity);
  const compacted = manager.build(
    {
      messages: [
        { role: "system", content: "same system" },
        { role: "assistant", content: "summary of previous work" },
        { role: "user", content: "continue after compaction" }
      ]
    },
    identity
  );

  assert.equal(compacted.stats.compaction, true);
  assert.equal(compacted.body.messages.some((message) => message.content === "old 17"), true);
});

test("SUB requests are passthrough and do not write MAIN state", () => {
  const manager = new WaterlineManager(defaultConfig, quietLogger);
  manager.build({ messages: [{ role: "user", content: "main" }] }, mainIdentity("main-session"));

  const sub = manager.build(
    { messages: [{ role: "user", content: "sub task" }] },
    {
      lane: "SUB",
      laneLabel: "[SUB:test]",
      sessionKey: "agent:main:subagent:123",
      sessionId: "",
      taskId: "",
      hasExplicitSession: true
    }
  );

  assert.equal(sub.stats.mode, "passthrough");
  assert.deepEqual(sub.body.messages, [{ role: "user", content: "sub task" }]);
  assert.equal(manager.getStateSummary().messages, 1);
});

test("waterline trim keeps recent full messages and archives older messages", () => {
  const config = structuredClone(defaultConfig);
  config.waterline = {
    recentFullTokens: 40,
    archiveQaTokens: 30,
    trimTriggerTokens: 90,
    trimTargetTokens: 70,
    archivedToolPrefixChars: 8
  };
  const manager = new WaterlineManager(config, quietLogger);
  const messages = [{ role: "system", content: "s" }];

  for (let index = 0; index < 16; index += 1) {
    messages.push({
      role: index % 2 ? "assistant" : "user",
      content: `message ${index} ${"x".repeat(30)}`
    });
  }
  messages.push({
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "call_1",
        type: "function",
        function: { name: "read", arguments: JSON.stringify({ path: "C:/very/long/path" }) }
      }
    ]
  });
  messages.push({ role: "tool", tool_call_id: "call_1", content: "tool output that is quite long" });

  const built = manager.build({ messages }, mainIdentity("main-session"));
  const summary = manager.getStateSummary();

  assert.equal(built.stats.mode, "trim");
  assert.equal(summary.trimCount, 1);
  assert.ok(summary.messages < messages.length);
  assert.equal(built.body.messages.at(-1).content, "tool output that is quite long");
});

test("empty ACS state trims an oversized first MAIN request before forwarding", () => {
  const config = structuredClone(defaultConfig);
  config.waterline = {
    recentFullTokens: 45,
    archiveQaTokens: 30,
    trimTriggerTokens: 100,
    trimTargetTokens: 75,
    archivedToolPrefixChars: 8
  };
  const manager = new WaterlineManager(config, quietLogger);
  const messages = [{ role: "system", content: "s" }];

  for (let index = 0; index < 24; index += 1) {
    messages.push({
      role: index % 2 ? "assistant" : "user",
      content: `old message ${index} ${"x".repeat(40)}`
    });
  }
  messages.push({ role: "user", content: "please trim safely" });

  const built = manager.build({ messages }, mainIdentity("main-session"));
  const summary = manager.getStateSummary();

  assert.equal(built.stats.mode, "trim");
  assert.equal(summary.trimCount, 1);
  assert.ok(built.body.messages.length < messages.length);
  assert.equal(built.body.messages.at(-1).content, "please trim safely");
});

test("findNewTail detects overlap inside compacted body", () => {
  const internal = [
    { role: "user", content: "a" },
    { role: "assistant", content: "b" },
    { role: "user", content: "c" }
  ];
  const incoming = [
    { role: "assistant", content: "summary" },
    { role: "assistant", content: "b" },
    { role: "user", content: "c" },
    { role: "assistant", content: "d" }
  ];

  assert.deepEqual(findNewTail(incoming, internal), [{ role: "assistant", content: "d" }]);
});

test("logger can be constructed", () => {
  assert.equal(typeof createLogger(defaultConfig).info, "function");
});

function mainIdentity(sessionKey) {
  return {
    lane: "MAIN",
    laneLabel: "[MAIN]",
    sessionKey,
    sessionId: sessionKey,
    taskId: "",
    hasExplicitSession: true,
    stripHeaderNames: []
  };
}
