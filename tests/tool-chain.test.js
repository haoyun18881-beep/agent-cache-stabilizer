import test from "node:test";
import assert from "node:assert/strict";
import { repairToolChain } from "../src/tool-chain.js";

test("assistant tool call without result gets a placeholder instead of deletion", () => {
  const result = repairToolChain([
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "read", arguments: "{}" }
        }
      ]
    },
    { role: "user", content: "next" }
  ]);

  assert.equal(result.addedPlaceholders, 1);
  assert.deepEqual(result.details.missingToolResults, [
    { after: 0, before: 1, id: "call_1", name: "read" }
  ]);
  assert.deepEqual(
    result.messages.map((message) => message.role),
    ["assistant", "tool", "user"]
  );
  assert.equal(result.messages[1].tool_call_id, "call_1");
});

test("orphan tool gets a minimal synthetic assistant", () => {
  const result = repairToolChain([{ role: "tool", tool_call_id: "call_orphan", content: "done" }]);

  assert.equal(result.addedAssistants, 1);
  assert.deepEqual(result.details.orphanTools, [{ at: 0, id: "call_orphan" }]);
  assert.deepEqual(
    result.messages.map((message) => message.role),
    ["assistant", "tool"]
  );
  assert.equal(result.messages[0].tool_calls[0].id, "call_orphan");
});

test("orphan tool cannot interrupt a pending assistant tool call", () => {
  const result = repairToolChain([
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_missing",
          type: "function",
          function: { name: "exec", arguments: "{}" }
        }
      ]
    },
    { role: "tool", tool_call_id: "call_orphan", content: "orphan output" },
    { role: "user", content: "next" }
  ]);

  assert.equal(result.addedPlaceholders, 1);
  assert.equal(result.addedAssistants, 1);
  assert.deepEqual(
    result.messages.map((message) => [message.role, message.tool_call_id || ""]),
    [
      ["assistant", ""],
      ["tool", "call_missing"],
      ["assistant", ""],
      ["tool", "call_orphan"],
      ["user", ""]
    ]
  );
  assert.equal(result.messages[2].tool_calls[0].id, "call_orphan");
});
