/**
 * Server-Sent Events (SSE) decoder using `eventsource-parser`.
 *
 * Extracted into its own module to handle streaming responses from OpenAI / llama.cpp.
 * Correctly handles split TCP chunks, multi-line data, and multi-byte UTF-8 boundaries.
 */

import { createParser, type EventSourceMessage } from "eventsource-parser";

export interface SseEvent {
  event: string | undefined;
  data: string;
  id: string | undefined;
}

export interface SseDecoder {
  /** Feed a chunk of text. Returns whatever complete events it now has. */
  push(chunk: string): SseEvent[];
  flush(): SseEvent[];
}

export function createSseDecoder(): SseDecoder {
  let events: SseEvent[] = [];

  const parser = createParser({
    onEvent(msg: EventSourceMessage) {
      events.push({
        event: msg.event,
        data: msg.data,
        id: msg.id,
      });
    },
  });

  return {
    push(chunk: string): SseEvent[] {
      events = [];
      parser.feed(chunk);
      return events;
    },
    flush(): SseEvent[] {
      return [];
    },
  };
}

/**
 * Adapt a byte stream (fetch's `response.body`) into decoded SSE events.
 */
export async function* iterateSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent, void, unknown> {
  const reader = body.getReader();
  const textDecoder = new TextDecoder();
  const sse = createSseDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // stream: true preserves multi-byte UTF-8 character boundaries
      const text = textDecoder.decode(value, { stream: true });
      for (const ev of sse.push(text)) {
        yield ev;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
