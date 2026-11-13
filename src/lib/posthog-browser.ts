import type { CaptureResult, CapturedNetworkRequest, PostHogConfig } from "posthog-js";
import {
  POSTHOG_PROXY_PATH,
  REPLAY_BLOCK_SELECTOR,
  REPLAY_MASK_SELECTOR,
  maskRecordedInput,
  posthogEndpoints,
  sanitizeAnalyticsProperties,
  sanitizeAnalyticsUrl,
  type InputMaskInfo,
} from "@/lib/posthog";

/** Client init. Events go to `/ingest`; ui_host is the cloud region that matches the ingestion host. */
export function posthogBrowserConfig(): Partial<PostHogConfig> {
  const { uiHost } = posthogEndpoints(process.env.NEXT_PUBLIC_POSTHOG_HOST);
  return {
    api_host: POSTHOG_PROXY_PATH,
    ui_host: uiHost,
    capture_pageview: false,
    capture_pageleave: true,
    person_profiles: "identified_only",
    disable_session_recording: false,
    enable_recording_console_log: false,
    autocapture: {
      capture_copied_text: false,
      capture_value_css_selector_allowlist: [],
    },
    get_current_url: (url) => sanitizeAnalyticsUrl(url),
    before_send: sanitizeCapture,
    session_recording: {
      maskAllInputs: true,
      maskInputOptions: { password: true },
      maskInputFn: (text, element) => maskRecordedInput(text, inputInfo(element)),
      maskTextSelector: REPLAY_MASK_SELECTOR,
      maskTextClass: "ph-mask",
      blockClass: "ph-no-capture",
      blockSelector: REPLAY_BLOCK_SELECTOR,
      recordHeaders: false,
      recordBody: false,
      maskCapturedNetworkRequestFn: (request) => sanitizeReplayRequest(request),
    },
  };
}

function sanitizeCapture(event: CaptureResult): CaptureResult | null {
  try {
    sanitizeAnalyticsProperties(event.properties as Record<string, unknown>);
    return event;
  } catch {
    return event;
  }
}

function sanitizeReplayRequest(request: CapturedNetworkRequest): CapturedNetworkRequest {
  try {
    if (typeof request.name === "string") request.name = sanitizeAnalyticsUrl(request.name);
    request.requestBody = null;
    request.responseBody = null;
    delete request.requestHeaders;
    delete request.responseHeaders;
  } catch {
    request.name = "";
    request.requestBody = null;
    request.responseBody = null;
  }
  return request;
}

function inputInfo(element?: HTMLElement): InputMaskInfo {
  const read = (name: string) => element?.getAttribute?.(name) ?? "";
  return {
    type: read("type"),
    name: read("name"),
    id: read("id"),
    autocomplete: read("autocomplete"),
    placeholder: read("placeholder"),
    className: read("class"),
    ariaLabel: read("aria-label"),
  };
}
