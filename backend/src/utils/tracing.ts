import { LangChainInstrumentation } from "@arizeai/openinference-instrumentation-langchain";
import { SEMRESATTRS_PROJECT_NAME } from "@arizeai/openinference-semantic-conventions";
import * as CallbackManagerModule from "@langchain/core/callbacks/manager";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, NodeTracerProvider, type ReadableSpan, type SpanExporter } from "@opentelemetry/sdk-trace-node";
import type { Config } from "@/utils/config.js";

const DEFAULT_PROJECT_NAME = "resume-ai";

/**
 * Sends LangChain spans to Phoenix over OTLP. No endpoint means no tracing at all.
 * With TRACE_CONTENT=false the instrumentation hides span inputs and outputs (prompts, CV text, replies),
 * so only timings, model names, token counts and errors are recorded.
 * Never called in tests. Returns the provider so a caller can flush it on shutdown.
 */
export function setupTracing(config: Pick<Config, "tracing">): NodeTracerProvider | undefined {
  const { endpoint, projectName, traceContent } = config.tracing;
  if (!endpoint) return undefined;

  const url = endpoint.replace(/\/+$/, "").endsWith("/v1/traces") ? endpoint : `${endpoint.replace(/\/+$/, "")}/v1/traces`;
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ [SEMRESATTRS_PROJECT_NAME]: projectName ?? DEFAULT_PROJECT_NAME }),
    spanProcessors: [new BatchSpanProcessor(guardExporter(new OTLPTraceExporter({ url }), traceContent))],
  });
  provider.register();

  instrumentLangChain(provider, traceContent);
  return provider;
}

/** Hooks LangChain's callback manager up to `provider`. Exported so a test can use its own provider. */
export function instrumentLangChain(provider: NodeTracerProvider, traceContent: boolean): LangChainInstrumentation {
  // Handlers queued in the background run in the wrong OTel context, so spans would get the wrong parent.
  process.env.LANGCHAIN_CALLBACKS_BACKGROUND = "false";
  const instrumentation = new LangChainInstrumentation({
    tracerProvider: provider,
    traceConfig: { hideInputs: !traceContent, hideOutputs: !traceContent },
  });
  // @langchain/core has no traditional module structure, so its callback manager is instrumented by hand.
  instrumentation.manuallyInstrument(CallbackManagerModule);
  return instrumentation;
}

/**
 * With `traceContent` false, drops what the instrumentation records outside the masked attributes: the
 * `exception` events and the status message of a failed LangChain run, which can quote the model output.
 * The status code stays, so an error is still an error. With `traceContent` true the exporter is returned as is.
 */
export function guardExporter(exporter: SpanExporter, traceContent: boolean): SpanExporter {
  if (traceContent) return exporter;
  return {
    export: (spans, resultCallback) => exporter.export(spans.map(withoutErrorContent), resultCallback),
    shutdown: () => exporter.shutdown(),
    forceFlush: () => exporter.forceFlush?.() ?? Promise.resolve(),
  };
}

function withoutErrorContent(span: ReadableSpan): ReadableSpan {
  return new Proxy(span, {
    get(target, prop) {
      if (prop === "events") return [];
      if (prop === "status") return { code: target.status.code };
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
