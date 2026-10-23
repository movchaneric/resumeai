import { OpenInferenceSpanKind, SemanticConventions } from "@arizeai/openinference-semantic-conventions";
import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";

/**
 * Runs `fn` inside an active CHAIN span, so spans started within it (LangChain's) nest under it.
 * On a throw the span gets status ERROR and `extraction.failure_reason` = the error's name, then the error is rethrown.
 * Never records messages, issues or other content: content tracing is controlled by TRACE_CONTENT alone (ADR 0006).
 * Imports only the OpenTelemetry API, which is a no-op until a tracer provider is registered.
 */
export async function withSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
  return trace.getTracer("resume-ai").startActiveSpan(name, async (span) => {
    span.setAttribute(SemanticConventions.OPENINFERENCE_SPAN_KIND, OpenInferenceSpanKind.CHAIN);
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.setAttribute("extraction.failure_reason", error instanceof Error ? error.name : "UnknownError");
      throw error;
    } finally {
      span.end();
    }
  });
}
