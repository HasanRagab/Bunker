import { randomUUID } from "node:crypto";
import type { BaseCtx, RouteMap, Router } from "./http/router";

type FetchHandler = (request: Request) => Promise<Response>;

export function createRequestMetrics(instanceId: string = randomUUID()) {
  const counts = new Map<string, number>();
  const durations = new Map<string, { count: number; sumMs: number }>();
  let inFlight = 0;

  const wrap = (handler: FetchHandler): FetchHandler => async (request) => {
    const method = request.method.toUpperCase();
    const started = performance.now();
    inFlight++;
    try {
      const response = await handler(request);
      const label = `${method}\t${response.status}`;
      counts.set(label, (counts.get(label) ?? 0) + 1);
      const timing = durations.get(method) ?? { count: 0, sumMs: 0 };
      timing.count++;
      timing.sumMs += performance.now() - started;
      durations.set(method, timing);
      return response;
    } finally {
      inFlight--;
    }
  };

  return {
    instanceId,
    wrap,
    snapshot() {
      return {
        instanceId,
        inFlight,
        requests: Object.fromEntries([...counts].map(([key, count]) => {
          const [method, status] = key.split("\t");
          return [`${method} ${status}`, count];
        })),
        durationsMs: Object.fromEntries([...durations].map(([method, value]) => [method, { ...value }])),
      };
    },
    prometheus() {
      const lines = [
        "# HELP kit_http_requests_total Completed HTTP requests.",
        "# TYPE kit_http_requests_total counter",
      ];
      for (const [key, count] of counts) {
        const [method, status] = key.split("\t");
        lines.push(`kit_http_requests_total{instance="${escapeLabel(instanceId)}",method="${escapeLabel(method!)}",status="${status}"} ${count}`);
      }
      lines.push("# HELP kit_http_requests_in_flight Current in-flight HTTP requests.", "# TYPE kit_http_requests_in_flight gauge");
      lines.push(`kit_http_requests_in_flight{instance="${escapeLabel(instanceId)}"} ${inFlight}`);
      lines.push("# HELP kit_http_request_duration_ms_sum Sum of HTTP request durations in milliseconds.", "# TYPE kit_http_request_duration_ms_sum counter");
      for (const [method, value] of durations) {
        lines.push(`kit_http_request_duration_ms_sum{instance="${escapeLabel(instanceId)}",method="${escapeLabel(method)}"} ${value.sumMs}`);
      }
      return `${lines.join("\n")}\n`;
    },
  };
}

export function metricsRoute<C extends BaseCtx, Routes extends RouteMap, Prefix extends string>(
  router: Router<C, Routes, Prefix>,
  metrics: ReturnType<typeof createRequestMetrics>,
  path = "/metrics",
): Router<C, Routes, Prefix> {
  router.get(path, {
    handler: () => new Response(metrics.prometheus(), {
      headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" },
    }),
  });
  return router;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
