import test from "node:test";
import assert from "node:assert/strict";
import { defaultConfig } from "../src/defaults.js";
import { IdentityResolver } from "../src/identity.js";

test("x-openclaw-session-key identifies sub agents", () => {
  const resolver = new IdentityResolver(defaultConfig);
  const identity = resolver.resolve(
    { "x-openclaw-session-key": "agent:main:subagent:abc" },
    { messages: [] }
  );

  assert.equal(identity.lane, "SUB");
  assert.equal(identity.sessionKey, "agent:main:subagent:abc");
});

test("user field can provide a stable main session fallback", () => {
  const resolver = new IdentityResolver(defaultConfig);
  const identity = resolver.resolve({}, { user: "openclaw-main", messages: [] });

  assert.equal(identity.lane, "MAIN");
  assert.equal(identity.sessionKey, "user:openclaw-main");
});

test("ACS task headers identify attributed sub agent requests", () => {
  const resolver = new IdentityResolver(defaultConfig);
  const identity = resolver.resolve(
    {
      "x-acs-lane": "SUB",
      "x-acs-task-id": "sa-test-123",
      "x-acs-task-name": "review-api",
      "x-acs-batch-name": "smoke"
    },
    { messages: [] }
  );

  assert.equal(identity.lane, "SUB");
  assert.equal(identity.taskId, "sa-test-123");
  assert.equal(identity.taskName, "review-api");
  assert.equal(identity.batchName, "smoke");
  assert.equal(identity.laneLabel, "[SUB:review-api]");
  assert.ok(identity.stripHeaderNames.includes("x-acs-lane"));
  assert.ok(identity.stripHeaderNames.includes("x-acs-task-name"));
});
