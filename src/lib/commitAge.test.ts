import { describe, expect, test } from "bun:test";
import { commitAge } from "./commitAge.ts";

const nowMs = Date.UTC(2026, 9, 20, 15, 0);
const nowSeconds = nowMs / 1000;
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("commitAge", () => {
  test("names the largest whole unit in English", () => {
    expect(commitAge("en-US", nowSeconds - 20, nowMs)).toBe("just now");
    expect(commitAge("en-US", nowSeconds - 5 * MINUTE - 30, nowMs)).toBe("5 minutes ago");
    expect(commitAge("en-US", nowSeconds - 3 * HOUR - 59 * MINUTE, nowMs)).toBe("3 hours ago");
    expect(commitAge("en-US", nowSeconds - 2 * DAY - 5 * HOUR, nowMs)).toBe("2 days ago");
    expect(commitAge("en-US", nowSeconds - 125 * DAY, nowMs)).toBe("4 months ago");
    expect(commitAge("en-US", nowSeconds - 800 * DAY, nowMs)).toBe("2 years ago");
  });

  test("speaks the UI language", () => {
    const ages = (locale: string) => [20, 5 * MINUTE, 3 * HOUR, 2 * DAY, 125 * DAY].map((ago) => commitAge(locale, nowSeconds - ago, nowMs));
    expect(ages("ja-JP")).toEqual(["たった今", "5 分前", "3 時間前", "2 日前", "4 か月前"]);
    expect(ages("ko-KR")).toEqual(["방금", "5분 전", "3시간 전", "2일 전", "4개월 전"]);
    expect(ages("zh-CN")).toEqual(["刚刚", "5分钟前", "3小时前", "2天前", "4个月前"]);
  });

  test("a time in the future or 0 is just now", () => {
    expect(commitAge("en-US", nowSeconds + 3 * HOUR, nowMs)).toBe("just now");
    expect(commitAge("en-US", 0, nowMs)).toBe("just now");
    expect(commitAge("ja-JP", 0, nowMs)).toBe("たった今");
  });
});
