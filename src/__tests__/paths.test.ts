import { describe, expect, it } from "vitest";
import {
  DOCUMENTS_PATH,
  SIGN_IN_PATH,
  isSafeRedirect,
  resolveRedirect,
  signInPath,
  startWritingPath,
} from "../lib/paths";

describe("isSafeRedirect", () => {
  it("accepts same-site paths", () => {
    expect(isSafeRedirect("/document")).toBe(true);
    expect(isSafeRedirect("/document/quantum-notes")).toBe(true);
    expect(isSafeRedirect("/x?a=1&b=2#frag")).toBe(true);
  });

  it("rejects anything that could leave the app", () => {
    expect(isSafeRedirect("//evil.test/steal")).toBe(false);
    expect(isSafeRedirect("/\\evil.test")).toBe(false);
    expect(isSafeRedirect("https://evil.test")).toBe(false);
    expect(isSafeRedirect("http://evil.test/document")).toBe(false);
    expect(isSafeRedirect("javascript:alert(1)")).toBe(false);
    expect(isSafeRedirect("document")).toBe(false);
    expect(isSafeRedirect("")).toBe(false);
    expect(isSafeRedirect("/has space")).toBe(false);
    expect(isSafeRedirect("/has\ttab")).toBe(false);
    expect(isSafeRedirect(null)).toBe(false);
    expect(isSafeRedirect(undefined)).toBe(false);
    expect(isSafeRedirect(42)).toBe(false);
    expect(isSafeRedirect("/" + "a".repeat(5_000))).toBe(false);
  });
});

describe("resolveRedirect", () => {
  it("defaults to the documents workspace, which is where Google sign-in must land", () => {
    expect(resolveRedirect(undefined)).toBe(DOCUMENTS_PATH);
    expect(resolveRedirect("//evil.test")).toBe(DOCUMENTS_PATH);
    expect(resolveRedirect(null, "/signin")).toBe("/signin");
    expect(resolveRedirect("/document/my-doc")).toBe("/document/my-doc");
  });
});

describe("startWritingPath", () => {
  it("sends guests to sign-in and members to their documents", () => {
    expect(startWritingPath("unauthenticated")).toBe(SIGN_IN_PATH);
    expect(startWritingPath("loading")).toBe(SIGN_IN_PATH);
    expect(startWritingPath("unknown")).toBe(SIGN_IN_PATH);
    expect(startWritingPath("authenticated")).toBe(DOCUMENTS_PATH);
  });
});

describe("signInPath", () => {
  it("keeps a safe destination and ignores the default one", () => {
    expect(signInPath()).toBe(SIGN_IN_PATH);
    expect(signInPath(DOCUMENTS_PATH)).toBe(SIGN_IN_PATH);
    expect(signInPath("/document/my-doc")).toBe(`${SIGN_IN_PATH}?next=%2Fdocument%2Fmy-doc`);
  });

  it("never forwards an unsafe destination", () => {
    expect(signInPath("//evil.test")).toBe(SIGN_IN_PATH);
    expect(signInPath("https://evil.test")).toBe(SIGN_IN_PATH);
  });
});
