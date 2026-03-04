import { NextResponse } from "next/server";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
  };
}

export const NO_STORE_PRIVATE_CACHE_CONTROL = "private, no-store";

export function apiError(
  status: number,
  code: string,
  message: string,
  requestId?: string,
) {
  return NextResponse.json<ApiErrorBody>(
    {
      error: {
        code,
        message,
        requestId,
      },
    },
    {
      status,
      headers: {
        "Cache-Control": NO_STORE_PRIVATE_CACHE_CONTROL,
      },
    },
  );
}
