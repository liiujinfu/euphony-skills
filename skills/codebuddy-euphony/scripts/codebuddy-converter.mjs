import fs from 'node:fs';
import path from 'node:path';
import { desktopSessionMtime } from './codebuddy-sessions.mjs';

export function stableJsonlOutputPath(source, type) {
  if (type === 'cli' && source.endsWith('.jsonl')) return source.replace(/\.jsonl$/, '.euphony.jsonl');
  return path.join(source, 'euphony.jsonl');
}

function parseJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Could not parse ${file}: ${error.message}`);
  }
}

function parseEmbeddedJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function sourceContentFromDesktopMessage(message, extra) {
  if (message.role === 'user' && Array.isArray(extra.sourceContentBlocks) && extra.sourceContentBlocks.length) {
    return extra.sourceContentBlocks;
  }
  if (Array.isArray(message.content)) return message.content;
  if (typeof message.content === 'string') return [{ type: 'text', text: message.content }];
  if (typeof message.message === 'string') return [{ type: 'text', text: message.message }];
  return [{ type: 'text', text: '[empty message]' }];
}

function desktopMessageTimestamp(messageId, requests, fallbackMs) {
  for (const request of requests) {
    if (Array.isArray(request.messages) && request.messages.includes(messageId) && request.startedAt) {
      return request.startedAt;
    }
  }
  return fallbackMs;
}

function extractWorkspaceFromText(text) {
  const match = /Workspace Folder:\s*([^\n\r]+)/.exec(text);
  return match?.[1]?.trim() || null;
}

function nonToolContent(content) {
  if (!Array.isArray(content)) return content;
  return content.filter(part => part?.type !== 'tool-call' && part?.type !== 'tool-result');
}

function desktopToolEvents({ content, baseEvent }) {
  if (!Array.isArray(content)) return [];
  const events = [];
  content.forEach((part, index) => {
    if (!part || typeof part !== 'object') return;
    if (part.type === 'tool-call') {
      events.push({
        ...baseEvent,
        id: `${baseEvent.id}-tool-call-${index}`,
        type: 'function_call',
        name: part.toolName || 'tool',
        callId: part.toolCallId || `${baseEvent.id}-tool-call-${index}`,
        arguments: part.args ?? {},
        status: 'completed',
        providerData: {
          ...baseEvent.providerData,
          toolCallId: part.toolCallId,
          toolName: part.toolName
        }
      });
    } else if (part.type === 'tool-result') {
      events.push({
        ...baseEvent,
        id: `${baseEvent.id}-tool-result-${index}`,
        type: 'function_call_result',
        name: part.toolName || 'tool',
        callId: part.toolCallId || `${baseEvent.id}-tool-result-${index}`,
        output: part.result ?? part,
        providerData: {
          ...baseEvent.providerData,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          isError: part.isError === true
        }
      });
    }
  });
  return events;
}

function readDesktopEvents(sessionDir) {
  const index = parseJsonFile(path.join(sessionDir, 'index.json'), { messages: [], requests: [] });
  const conversationIndex = parseJsonFile(path.join(path.dirname(sessionDir), 'index.json'), { conversations: [] });
  const conversationId = path.basename(sessionDir);
  const conversation = Array.isArray(conversationIndex.conversations)
    ? conversationIndex.conversations.find(item => item.id === conversationId)
    : null;
  const messages = Array.isArray(index.messages) ? index.messages : [];
  const requests = Array.isArray(index.requests) ? index.requests : [];
  const fallbackMs = desktopSessionMtime(sessionDir) || Date.now();

  return messages.flatMap((messageRef, indexInSession) => {
    const messageFile = path.join(sessionDir, 'messages', `${messageRef.id}.json`);
    const raw = parseJsonFile(messageFile, {});
    const embeddedMessage = parseEmbeddedJson(raw.message, {});
    const extra = parseEmbeddedJson(raw.extra, {});
    const role = raw.role || embeddedMessage.role || messageRef.role || 'assistant';
    const content = sourceContentFromDesktopMessage({ ...embeddedMessage, role }, extra);
    const text = textFromContent(content);
    const fullMessageText = textFromContent(embeddedMessage.content);
    const baseEvent = {
      id: raw.id || messageRef.id || `${conversationId}-desktop-${indexInSession}`,
      timestamp: desktopMessageTimestamp(messageRef.id, requests, fallbackMs),
      role,
      content,
      providerData: {
        desktop: true,
        requestId: extra.requestId,
        traceId: extra.traceId,
        model: extra.modelName || extra.modelId,
        isCancelled: extra.isCancelled,
        conversationName: conversation?.name,
        workspaceId: path.basename(path.dirname(sessionDir))
      },
      sessionId: conversationId,
      cwd: extractWorkspaceFromText(fullMessageText) || extractWorkspaceFromText(text) || path.dirname(sessionDir)
    };
    const events = [];
    const messageContent = nonToolContent(content);
    const messageText = textFromContent(messageContent).trim();
    if (messageText) {
      events.push({
        ...baseEvent,
        type: 'message',
        content: messageContent
      });
    }
    events.push(...desktopToolEvents({ content, baseEvent }));
    return events;
  });
}

function toIsoTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return toIsoTimestamp(numeric);
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function safeJsonParse(line, lineNumber, source) {
  try {
    return JSON.parse(line);
  } catch (error) {
    return {
      type: 'codebuddy-parse-error',
      timestamp: new Date().toISOString(),
      message: `Could not parse ${source}:${lineNumber}: ${error.message}`,
      rawLine: line
    };
  }
}

function readJsonl(file) {
  const text = fs.readFileSync(file, 'utf8');
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => safeJsonParse(line, index + 1, file));
}

function textFromContent(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(textFromContent).filter(Boolean).join('\n');
  if (value && typeof value === 'object') {
    if (value.type === 'resource_link') {
      const displayText = value._meta?.displayText || value.title || value.name || value.uri;
      if (displayText) return displayText;
    }
    for (const key of ['text', 'message', 'content', 'value']) {
      if (key in value) {
        const text = textFromContent(value[key]);
        if (text) return text;
      }
    }
    if (typeof value.type === 'string') return `[${value.type}]`;
  }
  return '';
}

function extractReasoning(event) {
  const parts = [];
  if (Array.isArray(event.rawContent)) {
    for (const part of event.rawContent) {
      const text = textFromContent(part);
      if (text) parts.push(text);
    }
  }
  if (Array.isArray(event.content)) {
    for (const part of event.content) {
      const text = textFromContent(part);
      if (text) parts.push(text);
    }
  }
  if (typeof event.providerData?.reasoning === 'string') parts.push(event.providerData.reasoning);
  return [...new Set(parts)].join('\n\n').trim();
}

function stringifyToolOutput(output) {
  if (typeof output === 'string') return output;
  if (output && typeof output === 'object') {
    const text = textFromContent(output);
    if (text && text !== '[text]') return text;
  }
  return JSON.stringify(output ?? null, null, 2);
}

function normalizeToolName(name) {
  return name === 'execute_command' ? 'exec_command' : name || 'tool';
}

function parseMaybeJSON(value) {
  if (typeof value !== 'string' || !value.trim()) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeToolArguments(event) {
  const rawArguments = event.arguments ?? event.input ?? {};
  const argumentsValue = parseMaybeJSON(rawArguments);
  if (
    (event.name === 'execute_command' || event.name === 'exec_command') &&
    argumentsValue &&
    typeof argumentsValue === 'object' &&
    typeof argumentsValue.command === 'string'
  ) {
    return { cmd: argumentsValue.command };
  }
  return argumentsValue;
}

function stringifyToolInput(input) {
  if (typeof input === 'string') {
    const parsed = parseMaybeJSON(input);
    if (parsed && typeof parsed === 'object') return JSON.stringify(parsed, null, 2);
    return input;
  }
  return JSON.stringify(input ?? {}, null, 2);
}

function stringifyToolResult(event) {
  const output = event.output ?? event.providerData?.toolResult ?? event;
  if (event.name === 'execute_command' || event.name === 'exec_command') {
    const result = output?.result;
    if (result && typeof result === 'object') {
      const parts = [];
      if (typeof result.stdout === 'string' && result.stdout) parts.push(result.stdout.trimEnd());
      if (typeof result.stderr === 'string' && result.stderr) parts.push(`stderr:\n${result.stderr.trimEnd()}`);
      if (typeof result.exitCode === 'number' && result.exitCode !== 0) parts.push(`exitCode: ${result.exitCode}`);
      if (parts.length) return parts.join('\n\n');
    }
  }
  return stringifyToolOutput(output);
}

function codexEvent(event, payload, type = 'response_item') {
  return { timestamp: toIsoTimestamp(event.timestamp), type, payload };
}

function convertEvent(event, index, sessionId) {
  const id = event.id || `${sessionId}-codebuddy-${index}`;
  if (event.type === 'message') {
    const role = typeof event.role === 'string' ? event.role : 'assistant';
    const text = textFromContent(event.content) || '[empty message]';
    return codexEvent(event, {
      type: 'message',
      id,
      role,
      content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }]
    });
  }
  if (event.type === 'reasoning') {
    const text = extractReasoning(event);
    if (!text) return null;
    return codexEvent(event, { type: 'reasoning', id, summary: [{ type: 'summary_text', text }] });
  }
  if (event.type === 'function_call') {
    const name = normalizeToolName(event.name || event.providerData?.name);
    const args = normalizeToolArguments(event);
    if (name !== 'exec_command') {
      return codexEvent(event, {
        type: 'custom_tool_call',
        id,
        name,
        call_id: event.callId || event.call_id || id,
        input: stringifyToolInput(args),
        status: event.status || 'completed'
      });
    }
    return codexEvent(event, {
      type: 'function_call',
      id,
      name,
      call_id: event.callId || event.call_id || id,
      arguments: JSON.stringify(args, null, 2),
      status: event.status || 'completed'
    });
  }
  if (event.type === 'function_call_result') {
    const name = normalizeToolName(event.name || event.providerData?.name);
    return codexEvent(event, {
      type: name === 'exec_command' ? 'function_call_output' : 'custom_tool_call_output',
      id,
      name,
      call_id: event.callId || event.call_id || id,
      output: stringifyToolResult(event)
    });
  }
  if (event.type === 'topic' && typeof event.topic === 'string') {
    return codexEvent(event, {
      type: 'message',
      id,
      role: 'system',
      content: [{ type: 'input_text', text: `Topic: ${event.topic}` }]
    });
  }
  if (event.type === 'codebuddy-parse-error') {
    return codexEvent(event, {
      type: 'message',
      id,
      role: 'system',
      content: [{ type: 'input_text', text: event.message }]
    });
  }
  return null;
}

function convertCodeBuddyToCodex(events, sourcePath) {
  const first = events[0] || {};
  const sessionId =
    first.sessionId ||
    events.find(event => typeof event.sessionId === 'string')?.sessionId ||
    path.basename(sourcePath, '.jsonl');
  const cwd =
    first.cwd || events.find(event => typeof event.cwd === 'string')?.cwd || path.dirname(sourcePath);
  const model = events.find(event => typeof event.providerData?.model === 'string')?.providerData.model || null;
  const startedAt = toIsoTimestamp(first.timestamp);
  const converted = [
    {
      timestamp: startedAt,
      type: 'session_meta',
      payload: {
        id: sessionId,
        timestamp: startedAt,
        cwd,
        originator: 'codebuddy',
        session_label: 'CodeBuddy session',
        source_path: sourcePath,
        cli_version: 'codebuddy',
        codebuddy_event_count: events.length
      }
    }
  ];

  if (model) converted.push({ timestamp: startedAt, type: 'turn_context', payload: { cwd, model, source: 'codebuddy' } });

  for (let index = 0; index < events.length; index += 1) {
    const mapped = convertEvent(events[index], index, sessionId);
    if (mapped) converted.push(mapped);
  }
  return converted;
}

export function convertCodeBuddySessionToCodex(session) {
  if (session.type === 'cli') return convertCodeBuddyToCodex(readJsonl(session.source), session.source);
  return convertCodeBuddyToCodex(readDesktopEvents(session.source), session.source);
}
