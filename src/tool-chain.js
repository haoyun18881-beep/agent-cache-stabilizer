import { cloneMessage, hasToolCalls } from "./message-utils.js";

export function repairToolChain(messages) {
  const repaired = [];
  const pending = [];
  const details = {
    missingToolResults: [],
    orphanTools: []
  };
  let addedPlaceholders = 0;
  let addedAssistants = 0;

  for (let index = 0; index < messages.length; index += 1) {
    const original = messages[index];
    const message = cloneMessage(original);

    if (pending.length > 0 && message.role !== "tool") {
      addedPlaceholders += flushPending(repaired, pending, details, index);
    }

    if (message.role === "tool") {
      const toolCallId = message.tool_call_id || "";
      const pendingIndex = pending.findIndex((item) => item.id === toolCallId);
      if (pendingIndex >= 0) {
        repaired.push(message);
        pending.splice(pendingIndex, 1);
      } else {
        if (pending.length > 0) {
          addedPlaceholders += flushPending(repaired, pending, details, index);
        }
        details.orphanTools.push({
          at: index,
          id: toolCallId || "missing_tool_call_id"
        });
        repaired.push(createSyntheticAssistant(toolCallId));
        repaired.push(message);
        addedAssistants += 1;
      }
      continue;
    }

    repaired.push(message);
    if (message.role === "assistant" && hasToolCalls(message)) {
      for (const call of message.tool_calls) {
        if (call?.id) {
          pending.push({
            id: call.id,
            name: call.function?.name || "tool",
            assistantAt: index
          });
        }
      }
    }
  }

  if (pending.length > 0) {
    addedPlaceholders += flushPending(repaired, pending, details, messages.length);
  }

  return {
    messages: repaired,
    addedPlaceholders,
    addedAssistants,
    details
  };
}

function flushPending(repaired, pending, details, beforeIndex) {
  let count = 0;
  while (pending.length > 0) {
    const item = pending.shift();
    details.missingToolResults.push({
      after: item.assistantAt,
      before: beforeIndex,
      id: item.id,
      name: item.name
    });
    repaired.push({
      role: "tool",
      tool_call_id: item.id,
      content: "[tool result archived]"
    });
    count += 1;
  }
  return count;
}

function createSyntheticAssistant(toolCallId) {
  return {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: toolCallId || "archived_tool_call",
        type: "function",
        function: {
          name: "archived_tool",
          arguments: "{}"
        }
      }
    ]
  };
}
