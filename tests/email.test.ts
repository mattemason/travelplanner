import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmail, signInEmail } from "@/lib/email";

describe("signInEmail", () => {
  it("puts the raw link in text and an escaped link in html", () => {
    const url = "https://example.com/api/auth/callback/email?token=a&email=b%40c.com";
    const email = signInEmail(url);
    expect(email.text).toContain(url);
    expect(email.html).toContain("token=a&amp;email=b%40c.com");
    expect(email.html).not.toContain('"><script');
  });
});

describe("sendEmail", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("posts to Postmark with the server token and stream", async () => {
    vi.stubEnv("POSTMARK_SERVER_TOKEN", "test-token");
    vi.stubEnv("EMAIL_FROM", "no-reply@socialtap.com.au");
    vi.stubEnv("POSTMARK_MESSAGE_STREAM", "outbound");
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail({ to: "a@b.com", subject: "S", text: "T", html: "<p>T</p>", tag: "sign-in" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.postmarkapp.com/email");
    expect(init.headers["X-Postmark-Server-Token"]).toBe("test-token");
    expect(JSON.parse(init.body)).toMatchObject({
      From: "no-reply@socialtap.com.au",
      To: "a@b.com",
      MessageStream: "outbound",
      Tag: "sign-in",
    });
  });

  it("throws with Postmark's message when the send is rejected", async () => {
    vi.stubEnv("POSTMARK_SERVER_TOKEN", "t");
    vi.stubEnv("EMAIL_FROM", "no-reply@socialtap.com.au");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ErrorCode: 400, Message: "Sender signature not confirmed" }), { status: 422 }),
      ),
    );
    await expect(sendEmail({ to: "a@b.com", subject: "S", text: "T", html: "T" })).rejects.toThrow(
      "Sender signature not confirmed",
    );
  });
});
