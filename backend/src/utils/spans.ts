import { OpenInferenceSpanKind, SemanticConventions } from "@arizeai/openinference-semantic-conventions";
import { SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";

export type { Span };

/**
 * Runs `fn` inside an active CHAIN span, so spans started within it (LangChain's) nest under it.
 * On a throw the span gets status ERROR and `failure_reason` = the error's name, then the error is rethrown.
 * Never records messages, issues or other content: content tracing is controlled by TRACE_CONTENT alone (ADR 0006).
 * `options.attributes` are set when the span starts, so they exist from the beginning.
 * Imports only the OpenTelemetry API, which is a no-op until a tracer provider is registered.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  options?: { attributes?: Attributes },
): Promise<T> {
  return trace.getTracer("resume-ai").startActiveSpan(name, { attributes: options?.attributes }, async (span) => {
    span.setAttribute(SemanticConventions.OPENINFERENCE_SPAN_KIND, OpenInferenceSpanKind.CHAIN);
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.setAttribute("failure_reason", error instanceof Error ? error.name : "UnknownError");
      throw error;
    } finally {
      span.end();
    }
  });
}

/** A root span for one stretch of a Run; Phoenix groups a Run's traces by session.id. */
export async function withSessionSpan<T>(name: string, sessionId: string, fn: (span: Span) => Promise<T>): Promise<T> {
  return withSpan(name, fn, { attributes: { [SemanticConventions.SESSION_ID]: sessionId } });
}
