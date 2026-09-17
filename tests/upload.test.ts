import { describe, it, expect } from "vitest";
import { POST } from "../src/app/api/legallens/upload/route";
import { NextRequest } from "next/server";

describe("Upload API Route", () => {
  it("rejects when no file is uploaded", async () => {
    const formData = new FormData();
    const req = new NextRequest("http://localhost/api/legallens/upload", {
      method: "POST",
      body: formData,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("No file uploaded");
  });

  it("rejects files that are too large", async () => {
    const formData = new FormData();
    const bigFile = new File([new ArrayBuffer(11 * 1024 * 1024)], "big.pdf", { type: "application/pdf" });
    formData.append("file", bigFile);
    
    const req = new NextRequest("http://localhost/api/legallens/upload", {
      method: "POST",
      body: formData,
    });

    const res = await POST(req);
    expect(res.status).toBe(413);
  });
});
