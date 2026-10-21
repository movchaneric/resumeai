import { LangChainInstrumentation } from "@arizeai/openinference-instrumentation-langchain";
import { SEMRESATTRS_PROJECT_NAME } from "@arizeai/openinference-semantic-conventions";
import * as CallbackManagerModule from "@langchain/core/callbacks/manager";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
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
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url }))],
  });
  provider.register();

  const instrumentation = new LangChainInstrumentation({
    tracerProvider: provider,
    traceConfig: { hideInputs: !traceContent, hideOutputs: !traceContent },
  });
  // @langchain/core has no traditional module structure, so its callback manager is instrumented by hand.
  instrumentation.manuallyInstrument(CallbackManagerModule);
  return provider;
}
