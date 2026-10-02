/**
 * Host half of the `dsh-bilibili` bundle.
 *
 * The browser half cannot talk to Bilibili directly: its API sends no CORS
 * headers, so a page fetch is rejected outright. Everything that leaves this
 * machine therefore happens here, behind same-origin routes on the DSH web
 * server (this mirrors how `dsh-client-deep-sneak` proxies the public API):
 *
 *   GET    /dsh-bilibili/session   -> { ok, loggedIn, profile, savedAt }
 *   POST   /dsh-bilibili/session   body { cookie } -> validate + persist
 *   DELETE /dsh-bilibili/session   -> forget the stored credential
 *
 *   GET    /dsh-bilibili/login/qrcode     -> { key, size, matrix } (matrix is
 *                                            one "0"/"1" row string per module)
 *   GET    /dsh-bilibili/login/poll?key=  -> { status: waiting | scanned |
 *                                            expired | ok | error }
 *   GET    /dsh-bilibili/feed?cursor=     -> { cursor, items, personalised }
 *
 * The credential is the account cookie (`SESSDATA` plus its companions). It is
 * validated against Bilibili's `nav` endpoint BEFORE being written to
 * `<DSH_HOME>/dsh-bilibili/session.json` with mode 0600, is never echoed back
 * to the browser, and is never logged.
 */
import { promises as fs } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import qrcode from "qrcode-generator";

export const inject = ["webServer"];

const ROUTE_PATH = "/dsh-bilibili/session";
const LOGIN_PREFIX = "/dsh-bilibili/login";
const FEED_PATH = "/dsh-bilibili/feed";
const PLAY_PATH = "/dsh-bilibili/play";
const MEDIA_PATH = "/dsh-bilibili/media";
const LIBRARY_PREFIX = "/dsh-bilibili/library";
const NAV_URL = "https://api.bilibili.com/x/web-interface/nav";
const VIEW_URL = "https://api.bilibili.com/x/web-interface/view";
const RCMD_URL = "https://api.bilibili.com/x/web-interface/index/top/rcmd";
const HISTORY_URL = "https://api.bilibili.com/x/web-interface/history/cursor";
const FAV_FOLDERS_URL = "https://api.bilibili.com/x/v3/fav/folder/created/list-all";
const FAV_LIST_URL = "https://api.bilibili.com/x/v3/fav/resource/list";
const SEARCH_URL = "https://api.bilibili.com/x/web-interface/wbi/search/type";
const PLAYURL_URL = "https://api.bilibili.com/x/player/playurl";
const QR_GENERATE_URL =
  "https://passport.bilibili.com/x/passport-login/web/qrcode/generate";
const QR_POLL_URL =
  "https://passport.bilibili.com/x/passport-login/web/qrcode/poll";

/** How many recommendations one batch hands to the panel. */
const FEED_SIZE = 12;
/** Highest `fresh_idx` the panel may ask for. */
const FEED_MAX_CURSOR = 50;
/**
 * A batch is served from memory for this long, and the next batch is fetched
 * in the background right after a miss — that is what makes 换一批 feel
 * instant instead of waiting on a live round trip.
 */
const FEED_CACHE_TTL_MS = 5 * 60 * 1000;
/** Outbound calls are bounded: a stalled Bilibili response must not hang the
 *  panel forever (the browser has no other way to give up). */
const BILI_TIMEOUT_MS = 9000;
const BILI_RETRY_DELAY_MS = 700;
/** Hosts the stream proxy will forward. Bilibili serves playurl from several
 *  CDN families, and the list is checked against the parsed hostname. */
const CDN_MARKERS = ["bilivideo", "mountaintoys", "hdslb", "akamaized"];

/**
 * Bilibili quality ids, used only as a fallback label when `playurl` returns an
 * id without a description. `accept_quality` is ordered best-first.
 */
const QUALITY_LABELS = {
  6: "240P", 16: "360P", 32: "480P", 64: "720P", 74: "720P60",
  80: "1080P", 112: "1080P+", 116: "1080P60", 120: "4K", 125: "HDR",
  126: "杜比视界", 127: "8K",
};
/** Ask for the top of the ladder and let Bilibili answer with its own ceiling. */
const QUALITY_REQUEST_MAX = 127;

/**
 * Bilibili reports the scan state inside `data.code`; the outer `code` only
 * says whether the call itself succeeded.
 */
const QR_WAITING = 86101;
const QR_SCANNED = 86090;
const QR_EXPIRED = 86038;
const QR_OK = 0;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const BILI_HEADERS = {
  "User-Agent": UA,
  Referer: "https://www.bilibili.com/",
};

/**
 * Cookie names worth keeping from a pasted header or a QR login; SESSDATA is
 * mandatory, the rest keep the request looking like the browser it came from.
 */
const KEPT_COOKIES = [
  "SESSDATA",
  "bili_jct",
  "DedeUserID",
  "DedeUserID__ckMd5",
  "sid",
  "buvid3",
  "buvid4",
  "b_nut",
];

/** A validated login is reused for this long before `nav` is asked again. */
const VALIDATE_TTL_MS = 30_000;
const MAX_BODY_BYTES = 16 * 1024;

/** Last live validation, so opening the panel does not hit Bilibili every time. */
let navCache = null;

/**
 * The single outstanding scan session. This is a local single-user tool, so one
 * at a time is enough, and keeping it in memory means a restart simply drops a
 * stale QR instead of leaving one lying around on disk.
 */
let pendingQr = null;

/**
 * qrcode-generator's ESM build only ships the latin1 byte encoder in
 * `stringToBytes`, which mangles non-ASCII code points. Bilibili scan URLs are
 * ASCII, but overriding with TextEncoder keeps any payload byte-exact.
 * (Verified by decoding the produced matrix with an independent decoder.)
 */
qrcode.stringToBytes = (text) => Array.from(new TextEncoder().encode(text));

/**
 * Encode one URL into a module matrix the browser can draw as SVG.
 * @param text - payload to encode.
 * @returns `{ size, matrix }` where matrix is one "0"/"1" string per row.
 */
function encodeMatrix(text) {
  const code = qrcode(0, "M");
  code.addData(text, "Byte");
  code.make();
  const size = code.getModuleCount();
  const matrix = [];
  for (let row = 0; row < size; row++) {
    let line = "";
    for (let column = 0; column < size; column++) {
      line += code.isDark(row, column) ? "1" : "0";
    }
    matrix.push(line);
  }
  return { size, matrix };
}

/**
 * GET a Bilibili endpoint, keeping the raw response so `Set-Cookie` survives.
 * @param url - absolute endpoint.
 * @returns `{ response, body }`.
 */
async function biliGet(url) {
  const response = await fetch(url, { headers: BILI_HEADERS });
  const body = await response.json();
  return { response, body };
}

/**
 * Recover the account cookies from a successful QR poll.
 *
 * Primary source is the poll's own `Set-Cookie`; the cross-domain URL in
 * `data.url` carries the same values as query parameters and is the fallback.
 * Either way the caller validates the result against `nav` before trusting it.
 * @param response - the poll response.
 * @param data - the poll response's `data` object.
 * @returns the normalized cookie header, or null when nothing usable arrived.
 */
function extractCookie(response, data) {
  const found = new Map();
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];
  for (const raw of setCookies) {
    const head = String(raw).split(";")[0];
    const at = head.indexOf("=");
    if (at <= 0) continue;
    const name = head.slice(0, at).trim();
    if (KEPT_COOKIES.includes(name)) found.set(name, head.slice(at + 1).trim());
  }
  if (!found.has("SESSDATA") && data && typeof data.url === "string") {
    try {
      const params = new URL(data.url).searchParams;
      for (const name of KEPT_COOKIES) {
        const value = params.get(name);
        if (value !== null && value !== "") found.set(name, value);
      }
    } catch {
      /* unparsable cross-domain url: fall through to the null below */
    }
  }
  if (!found.has("SESSDATA")) return null;
  return KEPT_COOKIES.filter((name) => found.has(name))
    .map((name) => name + "=" + found.get(name))
    .join("; ");
}

/**
 * Anonymous device marker. The recommendation feed answers without any cookie
 * at all, but a fresh buvid3 makes the request look like an ordinary browser
 * and keeps Bilibili from treating a cookie-less caller as suspicious.
 */
function mintBuvid3() {
  return "buvid3=" + randomUUID().toUpperCase() + "infoc";
}

/**
 * Project one `rcmd` entry down to what a card renders. Ads, live rooms and
 * other non-video rows carry no `bvid` and are dropped by the caller.
 * @param raw - one feed entry.
 * @returns the card view model.
 */
function toFeedItem(raw) {
  const stat = raw.stat ?? {};
  const owner = raw.owner ?? {};
  return {
    bvid: raw.bvid,
    cid: Number(raw.cid ?? 0),
    title: String(raw.title ?? ""),
    // The CDN answers http:// links; https keeps the page scheme-safe.
    cover: String(raw.pic ?? "").replace(/^http:/, "https:"),
    author: String(owner.name ?? ""),
    duration: Number(raw.duration ?? 0),
    views: Number(stat.view ?? 0),
    danmaku: Number(stat.danmaku ?? 0),
    published: Number(raw.pubdate ?? 0),
    reason: String(raw.rcmd_reason ?? raw.reason ?? ""),
  };
}

/**
 * One batch of Bilibili recommendations.
 *
 * `fresh_idx` selects the batch and Bilibili answers the SAME batch for the
 * same index (measured), so "next batch" is index + 1 and the panel's
 * "refresh" simply re-reads the current index.
 * @param cursor - 1-based batch index.
 * @returns `{ items, personalised }`.
 */
async function fetchFeed(cursor) {
  const record = await readSession();
  const headers = { ...BILI_HEADERS };
  // Logged in: the account cookie personalises the feed. Anonymous: mint a
  // throwaway device id instead of sending nothing.
  headers.Cookie = record === null ? mintBuvid3() : record.cookie;

  const url =
    RCMD_URL +
    "?fresh_type=3&ps=" + FEED_SIZE +
    "&fresh_idx=" + cursor +
    "&feed_version=V8";
  const response = await biliFetch(url, headers);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    // Bilibili rate-limits bursts by returning an empty body.
    throw new Error(
      "Bilibili returned a non-JSON feed response (HTTP " + response.status + ")",
    );
  }
  if (body.code !== 0) {
    throw new Error(body.message || "feed refused with code " + body.code);
  }
  const raw = (body.data && body.data.item) || [];
  const items = raw
    .filter((entry) => entry && typeof entry.bvid === "string" && entry.bvid !== "")
    .map(toFeedItem)
    .slice(0, FEED_SIZE);
  return { items, personalised: record !== null };
}

/**
 * Bounded outbound GET. A stalled Bilibili response must fail rather than hang
 * the panel, because the browser has no way to give up on our route.
 */
async function biliFetch(url, headers) {
  return fetch(url, { headers, signal: AbortSignal.timeout(BILI_TIMEOUT_MS) });
}

/** cursor -> { items, personalised, at }. Cleared whenever the account changes. */
const feedCache = new Map();

function clearFeedCache() {
  feedCache.clear();
}

function cachedFeed(cursor) {
  const hit = feedCache.get(cursor);
  if (hit === undefined) return null;
  if (Date.now() - hit.at > FEED_CACHE_TTL_MS) {
    feedCache.delete(cursor);
    return null;
  }
  return hit;
}

/**
 * Fetch one batch with a single retry. Measured: Bilibili answers a burst with
 * an empty body rather than an error, and the next attempt usually succeeds.
 */
async function fetchFeedWithRetry(cursor) {
  try {
    return await fetchFeed(cursor);
  } catch (first) {
    await new Promise((resolve) => setTimeout(resolve, BILI_RETRY_DELAY_MS));
    return await fetchFeed(cursor);
  }
}

/** Warm one batch in the background. Best effort: failures are dropped. */
function prefetchFeed(cursor) {
  if (cursor > FEED_MAX_CURSOR || cachedFeed(cursor) !== null) return;
  fetchFeedWithRetry(cursor)
    .then((batch) => {
      feedCache.set(cursor, { ...batch, at: Date.now() });
    })
    .catch(() => {
      /* prefetch is an optimisation; the button will fetch it for real */
    });
}

/**
 * One batch, served from the cache when possible.
 *
 * A hit returns immediately and still warms the NEXT batch, so the following
 * 换一批 is instant instead of waiting on a live round trip.
 * @param cursor - 1-based batch index.
 * @returns `{ items, personalised, cached }`.
 */
async function feedBatch(cursor) {
  const hit = cachedFeed(cursor);
  if (hit !== null) {
    prefetchFeed(cursor + 1);
    return { ...hit, cached: true };
  }
  const batch = await fetchFeedWithRetry(cursor);
  feedCache.set(cursor, { ...batch, at: Date.now() });
  prefetchFeed(cursor + 1);
  return { ...batch, cached: false };
}

/**
 * Ask the video page which page id to play. Needed for anything that arrives
 * without a cid (search results, some history rows).
 */
async function resolveCid(bvid, headers) {
  const response = await biliFetch(
    VIEW_URL + "?bvid=" + encodeURIComponent(bvid),
    headers,
  );
  const body = await response.json();
  if (body.code !== 0) {
    throw new Error(body.message || "could not resolve this video");
  }
  const cid = Number(body.data && body.data.cid);
  if (!Number.isFinite(cid) || cid <= 0) {
    throw new Error("this video has no playable page");
  }
  return cid;
}

/**
 * Resolve a playable stream for one video.
 *
 * The URL Bilibili returns is Referer-gated and bound to the requesting IP, so
 * it is never handed straight to the browser: the panel points a <video> at
 * our own media route and the Host forwards the bytes with the right headers.
 * @param bvid - video id.
 * @param cid - page id (the feed already carries it).
 * @returns `{ url, quality, format, size }`.
 */
async function fetchPlay(bvid, cid, qn) {
  const record = await readSession();
  const headers = { ...BILI_HEADERS };
  if (record !== null) headers.Cookie = record.cookie;
  // Search results have no cid, so resolve it from the video page.
  let pageId = Number(cid);
  if (!Number.isFinite(pageId) || pageId <= 0) {
    pageId = await resolveCid(bvid, headers);
  }
  // Asking for the top of the ladder returns Bilibili's own ceiling for this
  // account and video, and that ceiling is what "highest quality" means here.
  // NOTE: with fnval=1 (progressive mp4) that ceiling is 720P — anything above
  // it is only served as DASH, which a plain <video> cannot play.
  const requested = Number.isFinite(qn) && qn > 0 ? Math.floor(qn) : QUALITY_REQUEST_MAX;
  const url =
    PLAYURL_URL +
    "?bvid=" + encodeURIComponent(bvid) +
    "&cid=" + encodeURIComponent(pageId) +
    "&qn=" + requested +
    "&fnval=1&fnver=0&fourk=1";
  const response = await biliFetch(url, headers);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      "Bilibili returned a non-JSON playurl response (HTTP " + response.status + ")",
    );
  }
  if (body.code !== 0) {
    throw new Error(body.message || "playurl refused with code " + body.code);
  }
  const data = body.data || {};
  const first = (data.durl || [])[0];
  if (!first || typeof first.url !== "string" || first.url === "") {
    throw new Error("no playable stream was returned");
  }
  const ids = Array.isArray(data.accept_quality) ? data.accept_quality : [];
  const labels = Array.isArray(data.accept_description) ? data.accept_description : [];
  const qualities = ids.map((id, index) => ({
    qn: Number(id),
    label: labels[index] || QUALITY_LABELS[Number(id)] || String(id),
  }));
  const actual = Number(data.quality ?? 0);
  const at = ids.indexOf(actual);
  return {
    url: first.url,
    quality: actual,
    qualityLabel: at >= 0 && labels[at] ? labels[at] : QUALITY_LABELS[actual] || "",
    qualities,
    format: String(data.format ?? ""),
    size: Number(first.size ?? 0),
  };
}

/**
 * Whether a URL belongs to a Bilibili CDN the stream proxy will forward.
 * Checked against the parsed hostname so a lookalike domain cannot slip past.
 */
function isCdnUrl(raw) {
  try {
    const host = new URL(raw).hostname;
    return CDN_MARKERS.some((marker) => host.includes(marker));
  } catch {
    return false;
  }
}

// ---- search / history / favourites -------------------------------------

/** Bilibili's fixed permutation for deriving the wbi mixin key. */
const WBI_MIXIN = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
];
const WBI_TTL_MS = 6 * 60 * 60 * 1000;
let wbiKeys = null;

/** Derive the 32-character mixin key from the two published wbi images. */
function wbiMixinKey(orig) {
  return WBI_MIXIN.map((n) => orig[n]).join("").slice(0, 32);
}

/** Query escaping that matches what Bilibili signs against (space is "+"). */
function wbiEscape(value) {
  return encodeURIComponent(String(value))
    .replace(/%20/g, "+")
    .replace(/~/g, "%7E")
    .replace(/[!()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/** The wbi keys, refetched every few hours. */
async function getWbiKeys() {
  const now = Date.now();
  if (wbiKeys !== null && now - wbiKeys.at < WBI_TTL_MS) return wbiKeys;
  const response = await biliFetch(NAV_URL, { ...BILI_HEADERS });
  const body = await response.json();
  const image = (body.data && body.data.wbi_img && body.data.wbi_img.img_url) || "";
  const sub = (body.data && body.data.wbi_img && body.data.wbi_img.sub_url) || "";
  const stem = (url) => String(url).split("/").pop().split(".")[0];
  if (stem(image) === "" || stem(sub) === "") {
    throw new Error("could not read the wbi signing keys");
  }
  wbiKeys = { img: stem(image), sub: stem(sub), at: now };
  return wbiKeys;
}

/**
 * Sign parameters for a wbi endpoint: sorted, escaping-normalised, with `wts`
 * appended and `w_rid` = md5(query + mixin). Required by search, which answers
 * 412 to an unsigned caller.
 */
function wbiSigned(params, keys) {
  const mixin = wbiMixinKey(keys.img + keys.sub);
  const all = { ...params, wts: Math.round(Date.now() / 1000) };
  const clean = {};
  for (const key of Object.keys(all)) {
    if (/^w_/.test(key)) continue;
    clean[key] = String(all[key]).replace(/[!'()*]/g, "");
  }
  const query = Object.keys(clean)
    .sort()
    .map((key) => key + "=" + wbiEscape(clean[key]))
    .join("&");
  const wRid = createHash("md5").update(query + mixin).digest("hex");
  return query + "&w_rid=" + wRid;
}

/** Search titles arrive wrapped in <em class="keyword"> highlight markup. */
function cleanTitle(raw) {
  return String(raw ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Covers arrive as http:// or as a protocol-relative //i0.hdslb.com/... */
function absoluteCover(raw) {
  const url = String(raw ?? "");
  if (url === "") return "";
  if (url.startsWith("//")) return "https:" + url;
  return url.replace(/^http:/, "https:");
}

/** Search reports duration as "m:ss" (or "h:mm:ss"), not seconds. */
function parseDuration(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.floor(raw);
  const text = String(raw ?? "");
  if (text === "") return 0;
  const parts = text.split(":").map((piece) => Number(piece));
  if (parts.some((piece) => !Number.isFinite(piece))) return 0;
  return parts.reduce((total, piece) => total * 60 + piece, 0);
}

/** The account cookie, or a thrown error the panel can show. */
async function requireCookie() {
  const record = await readSession();
  if (record === null) throw new Error("not signed in");
  return record;
}

/**
 * One page of the watch history. Cursor paging uses Bilibili's opaque
 * (max, view_at, business) triple rather than a page number.
 */
async function fetchHistory(cursor) {
  const record = await requireCookie();
  const url =
    HISTORY_URL +
    "?ps=" + FEED_SIZE +
    "&max=" + Number(cursor.max ?? 0) +
    "&view_at=" + Number(cursor.viewAt ?? 0) +
    "&business=" + encodeURIComponent(String(cursor.business ?? ""));
  const response = await biliFetch(url, { ...BILI_HEADERS, Cookie: record.cookie });
  const body = await response.json();
  if (body.code !== 0) {
    throw new Error(body.message || "history refused with code " + body.code);
  }
  const data = body.data || {};
  const items = (data.list || [])
    .filter((entry) => entry && entry.history && typeof entry.history.bvid === "string" && entry.history.bvid !== "")
    .map((entry) => ({
      bvid: entry.history.bvid,
      cid: Number(entry.history.cid ?? 0),
      title: cleanTitle(entry.title || entry.show_title),
      cover: absoluteCover(entry.cover),
      author: String(entry.author_name ?? ""),
      duration: Number(entry.duration ?? 0),
      views: 0,
      published: Number(entry.view_at ?? 0),
    }));
  const next = data.cursor || {};
  return {
    items,
    // An empty page means the history ended; the cursor itself never says so.
    hasMore: items.length > 0,
    cursor: {
      max: Number(next.max ?? 0),
      viewAt: Number(next.view_at ?? 0),
      business: String(next.business ?? ""),
    },
  };
}

let favFolder = null;

/**
 * The folder the 收藏 view reads: the default one when present, else the first.
 * Cached because the panel asks for it on every page.
 */
async function defaultFavFolder(record) {
  if (favFolder !== null) return favFolder;
  const mid = record.profile && record.profile.mid;
  if (mid === undefined || mid === null) throw new Error("no account id on file");
  const response = await biliFetch(
    FAV_FOLDERS_URL + "?up_mid=" + encodeURIComponent(mid),
    { ...BILI_HEADERS, Cookie: record.cookie },
  );
  const body = await response.json();
  if (body.code !== 0) {
    throw new Error(body.message || "favourites refused with code " + body.code);
  }
  const list = (body.data && body.data.list) || [];
  const chosen = list.find((entry) => String(entry.title).includes("默认")) || list[0];
  if (!chosen) throw new Error("this account has no favourite folder");
  favFolder = {
    id: chosen.id,
    title: String(chosen.title ?? ""),
    count: Number(chosen.media_count ?? 0),
  };
  return favFolder;
}

/** One page of the default favourite folder. */
async function fetchFavourites(page) {
  const record = await requireCookie();
  const folder = await defaultFavFolder(record);
  const url =
    FAV_LIST_URL +
    "?media_id=" + folder.id +
    "&pn=" + page +
    "&ps=" + FEED_SIZE +
    "&order=mtime&type=0&platform=web";
  const response = await biliFetch(url, { ...BILI_HEADERS, Cookie: record.cookie });
  const body = await response.json();
  if (body.code !== 0) {
    throw new Error(body.message || "favourites refused with code " + body.code);
  }
  const data = body.data || {};
  const items = (data.medias || [])
    .filter((entry) => entry && typeof entry.bvid === "string" && entry.bvid !== "")
    .map((entry) => ({
      bvid: entry.bvid,
      cid: Number(entry.cid ?? 0),
      title: cleanTitle(entry.title),
      cover: absoluteCover(entry.cover),
      author: String((entry.upper && entry.upper.name) || ""),
      duration: Number(entry.duration ?? 0),
      views: Number((entry.cnt_info && entry.cnt_info.play) ?? 0),
      published: Number(entry.pubtime ?? 0),
    }));
  return { items, folder: folder.title, hasMore: data.has_more === true };
}

/** One page of search results. Signed, because the endpoint demands it. */
async function fetchSearch(keyword, page) {
  const record = await readSession();
  const query = wbiSigned({ search_type: "video", keyword, page }, await getWbiKeys());
  const headers = { ...BILI_HEADERS };
  if (record !== null) headers.Cookie = record.cookie;
  const response = await biliFetch(SEARCH_URL + "?" + query, headers);
  const body = await response.json();
  if (body.code !== 0) {
    throw new Error(body.message || "search refused with code " + body.code);
  }
  const data = body.data || {};
  const current = Number(data.page ?? page);
  const pages = Number(data.numPages ?? 1);
  const items = (data.result || [])
    .filter((entry) => entry && typeof entry.bvid === "string" && entry.bvid !== "")
    .map((entry) => ({
      bvid: entry.bvid,
      // Search results carry no cid; the play route resolves it.
      cid: 0,
      title: cleanTitle(entry.title),
      cover: absoluteCover(entry.pic),
      author: String(entry.author ?? ""),
      duration: parseDuration(entry.duration),
      views: Number(entry.play ?? 0),
      published: Number(entry.pubdate ?? 0),
    }));
  return { items, page: current, pages, hasMore: current < pages };
}

/** `<DSH_HOME>/dsh-bilibili`, falling back to `~/.dsh/dsh-bilibili`. */
function dataDir() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  return path.join(home, "dsh-bilibili");
}

function sessionFile() {
  return path.join(dataDir(), "session.json");
}

/**
 * Accept either a full pasted cookie header or a bare SESSDATA value, and keep
 * only the names this plugin understands.
 * @param input - raw text from the panel.
 * @returns the normalized cookie header, or null when no SESSDATA is present.
 */
function normalizeCookie(input) {
  const raw = String(input ?? "").trim();
  if (raw === "") return null;
  if (!/SESSDATA\s*=/.test(raw)) {
    // Treated as a bare SESSDATA value.
    const value = raw.replace(/^SESSDATA\s*=\s*/i, "").replace(/[;\s]+$/, "");
    return value === "" ? null : "SESSDATA=" + value;
  }
  const pairs = [];
  for (const part of raw.split(/[;\n\r]+/)) {
    const text = part.trim();
    if (text === "") continue;
    const at = text.indexOf("=");
    if (at <= 0) continue;
    const name = text.slice(0, at).trim();
    if (KEPT_COOKIES.includes(name)) pairs.push([name, text.slice(at + 1).trim()]);
  }
  if (!pairs.some(([name]) => name === "SESSDATA")) return null;
  return pairs.map(([name, value]) => name + "=" + value).join("; ");
}

/** Project the `nav` payload down to what the panel renders. */
function toProfile(data) {
  const level = data.level_info ?? {};
  return {
    mid: data.mid ?? null,
    name: data.uname ?? null,
    face: data.face ?? null,
    level: level.current_level ?? null,
    vip: data.vipStatus === 1,
    coins: data.money ?? null,
  };
}

/**
 * Ask Bilibili who this cookie belongs to.
 * @param cookie - normalized cookie header.
 * @returns `{ isLogin, code, message, profile }`.
 */
async function fetchNav(cookie) {
  const response = await fetch(NAV_URL, {
    headers: { ...BILI_HEADERS, Cookie: cookie },
  });
  const body = await response.json();
  const data = body.data ?? {};
  return {
    isLogin: body.code === 0 && data.isLogin === true,
    code: body.code,
    message: body.message ?? "",
    profile: toProfile(data),
  };
}

/** Cached validation for the exact cookie that was last checked. */
async function validate(cookie, force = false) {
  const now = Date.now();
  if (
    !force &&
    navCache !== null &&
    navCache.cookie === cookie &&
    now - navCache.at < VALIDATE_TTL_MS
  ) {
    return navCache.result;
  }
  const result = await fetchNav(cookie);
  navCache = { cookie, at: now, result };
  return result;
}

async function readSession() {
  try {
    const parsed = JSON.parse(await fs.readFile(sessionFile(), "utf8"));
    if (parsed !== null && typeof parsed === "object" && typeof parsed.cookie === "string") {
      return parsed;
    }
  } catch {
    /* absent or unreadable: treat as logged out */
  }
  return null;
}

async function writeSession(record) {
  const dir = dataDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const target = sessionFile();
  const staging = target + ".tmp";
  await fs.writeFile(staging, JSON.stringify(record, null, 2), { mode: 0o600 });
  await fs.rename(staging, target);
  await fs.chmod(target, 0o600).catch(() => {});
  // The feed is personalised, so a new credential invalidates every cached batch.
  clearFeedCache();
}

async function clearSession() {
  await fs.rm(sessionFile(), { force: true });
  navCache = null;
  // The feed is personalised, so a sign-out invalidates every cached batch.
  clearFeedCache();
}

/**
 * Reject requests a foreign page triggered: a browser always sends `Origin`
 * for cross-site writes, and it will not match this server's own host.
 */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (origin === undefined || origin === "") return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  return JSON.parse(text);
}

function registerSessionRoutes(ctx) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "prefix",
        path: ROUTE_PATH,
        handler: async (req, res) => {
          const send = (status, body) => {
            res.writeHead(status, {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            });
            res.end(JSON.stringify(body));
          };

          if (!sameOrigin(req)) {
            send(403, { ok: false, error: "forbidden origin" });
            return;
          }
          const pathname = new URL(req.url, "http://localhost").pathname;
          if (pathname !== ROUTE_PATH) {
            send(404, { ok: false, error: "not found" });
            return;
          }

          try {
            if (req.method === "GET") {
              const record = await readSession();
              if (record === null) {
                send(200, { ok: true, loggedIn: false });
                return;
              }
              const result = await validate(record.cookie);
              if (!result.isLogin) {
                send(200, {
                  ok: true,
                  loggedIn: false,
                  savedAt: record.savedAt ?? null,
                  reason: "expired",
                });
                return;
              }
              send(200, {
                ok: true,
                loggedIn: true,
                profile: result.profile,
                savedAt: record.savedAt ?? null,
              });
              return;
            }

            if (req.method === "POST") {
              const body = await readJsonBody(req);
              const cookie = normalizeCookie(body.cookie);
              if (cookie === null) {
                send(400, {
                  ok: false,
                  error: "SESSDATA not found in the pasted text",
                });
                return;
              }
              const result = await validate(cookie, true);
              if (!result.isLogin) {
                send(400, {
                  ok: false,
                  error: result.message || "credential rejected by Bilibili",
                  code: result.code,
                });
                return;
              }
              const savedAt = new Date().toISOString();
              await writeSession({
                cookie,
                savedAt,
                profile: result.profile,
              });
              send(200, {
                ok: true,
                loggedIn: true,
                profile: result.profile,
                savedAt,
              });
              return;
            }

            if (req.method === "DELETE") {
              await clearSession();
              send(200, { ok: true, loggedIn: false });
              return;
            }

            send(405, { ok: false, error: "method not allowed" });
          } catch (error) {
            send(500, {
              ok: false,
              error: String((error && error.message) || error),
            });
          }
        },
      }),
    "dsh-bilibili: session route",
  );
}

/**
 * The QR sign-in pair. The browser asks for a code, then polls this route; the
 * credential exchange itself never leaves the host.
 */
function registerLoginRoutes(ctx) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "prefix",
        path: LOGIN_PREFIX,
        handler: async (req, res) => {
          const send = (status, body) => {
            res.writeHead(status, {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            });
            res.end(JSON.stringify(body));
          };

          if (!sameOrigin(req)) {
            send(403, { ok: false, error: "forbidden origin" });
            return;
          }

          const at = new URL(req.url, "http://localhost");
          try {
            if (req.method === "GET" && at.pathname === LOGIN_PREFIX + "/qrcode") {
              const { body } = await biliGet(QR_GENERATE_URL);
              if (body.code !== QR_OK || !body.data || !body.data.qrcode_key) {
                send(502, {
                  ok: false,
                  error: body.message || "Bilibili refused to issue a QR code",
                });
                return;
              }
              const key = body.data.qrcode_key;
              const url = String(body.data.url || "");
              pendingQr = { key, at: Date.now() };
              let encoded;
              try {
                encoded = encodeMatrix(url);
              } catch (error) {
                send(500, {
                  ok: false,
                  error: "could not encode the QR code: " +
                    String((error && error.message) || error),
                });
                return;
              }
              send(200, {
                ok: true,
                key,
                size: encoded.size,
                matrix: encoded.matrix,
              });
              return;
            }

            if (req.method === "GET" && at.pathname === LOGIN_PREFIX + "/poll") {
              const key = at.searchParams.get("key");
              if (key === null || key === "" || pendingQr === null || pendingQr.key !== key) {
                // The QR this key belongs to is gone: a restart, or a newer
                // code was issued. The browser must ask for a fresh one.
                send(409, { ok: false, status: "stale" });
                return;
              }
              const { response, body } = await biliGet(
                QR_POLL_URL + "?qrcode_key=" + encodeURIComponent(key),
              );
              const data = body.data || {};
              if (data.code === QR_WAITING) {
                send(200, { ok: true, status: "waiting" });
                return;
              }
              if (data.code === QR_SCANNED) {
                send(200, { ok: true, status: "scanned" });
                return;
              }
              if (data.code === QR_EXPIRED) {
                pendingQr = null;
                send(200, { ok: true, status: "expired" });
                return;
              }
              if (data.code !== QR_OK) {
                send(200, {
                  ok: false,
                  status: "error",
                  error: data.message || body.message || "unknown QR state",
                });
                return;
              }

              // Scanned and confirmed: exchange the session for a cookie.
              const cookie = extractCookie(response, data);
              if (cookie === null) {
                send(200, {
                  ok: false,
                  status: "error",
                  error: "Bilibili confirmed the scan but sent no credentials",
                });
                return;
              }
              const result = await validate(cookie, true);
              if (!result.isLogin) {
                send(200, {
                  ok: false,
                  status: "error",
                  error: result.message || "the scanned credential was rejected",
                });
                return;
              }
              const savedAt = new Date().toISOString();
              await writeSession({
                cookie,
                savedAt,
                profile: result.profile,
                source: "qrcode",
              });
              pendingQr = null;
              send(200, {
                ok: true,
                status: "ok",
                loggedIn: true,
                profile: result.profile,
                savedAt,
              });
              return;
            }

            send(404, { ok: false, error: "not found" });
          } catch (error) {
            send(502, {
              ok: false,
              status: "error",
              error: String((error && error.message) || error),
            });
          }
        },
      }),
    "dsh-bilibili: login routes",
  );
}

/**
 * The recommendation feed. Same-origin only, so the panel can read it while the
 * browser stays unable to reach Bilibili itself.
 */
function registerFeedRoute(ctx) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: FEED_PATH,
        handler: async (req, res) => {
          const send = (status, body) => {
            res.writeHead(status, {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            });
            res.end(JSON.stringify(body));
          };

          if (!sameOrigin(req)) {
            send(403, { ok: false, error: "forbidden origin" });
            return;
          }
          if (req.method !== "GET") {
            send(405, { ok: false, error: "method not allowed" });
            return;
          }

          const asked = Number(
            new URL(req.url, "http://localhost").searchParams.get("cursor"),
          );
          const cursor = Math.min(
            FEED_MAX_CURSOR,
            Math.max(1, Number.isFinite(asked) ? Math.floor(asked) : 1),
          );

          try {
            const feed = await feedBatch(cursor);
            send(200, { ok: true, cursor, ...feed });
          } catch (error) {
            send(502, {
              ok: false,
              error: String((error && error.message) || error),
            });
          }
        },
      }),
    "dsh-bilibili: feed route",
  );
}

/**
 * Playback. Two routes, because the browser can do neither half by itself:
 * `play` resolves a stream URL, and `media` forwards the bytes with the
 * Referer the CDN demands (measured: no Referer, or a foreign one, is a 403).
 */
function registerPlayRoutes(ctx) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: PLAY_PATH,
        handler: async (req, res) => {
          const send = (status, body) => {
            res.writeHead(status, {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            });
            res.end(JSON.stringify(body));
          };
          if (!sameOrigin(req)) {
            send(403, { ok: false, error: "forbidden origin" });
            return;
          }
          if (req.method !== "GET") {
            send(405, { ok: false, error: "method not allowed" });
            return;
          }
          const params = new URL(req.url, "http://localhost").searchParams;
          const bvid = params.get("bvid");
          const cid = Number(params.get("cid"));
          if (bvid === null || !/^BV[0-9A-Za-z]{10}$/.test(bvid)) {
            send(400, { ok: false, error: "a valid bvid is required" });
            return;
          }
          try {
            // `cid` is optional: search results and some history rows have none,
            // and fetchPlay resolves it from the video page. `qn` is optional
            // too: without it fetchPlay asks for the top of the ladder and
            // reports back whatever ceiling Bilibili grants this account.
            const asked = Number(params.get("qn"));
            const play = await fetchPlay(
              bvid,
              Number.isFinite(cid) ? cid : 0,
              Number.isFinite(asked) ? asked : 0,
            );
            // Only ever hand back a pointer into our own media route.
            send(200, {
              ok: true,
              bvid,
              quality: play.quality,
              qualityLabel: play.qualityLabel,
              qualities: play.qualities,
              format: play.format,
              size: play.size,
              stream: MEDIA_PATH + "?u=" + encodeURIComponent(play.url),
            });
          } catch (error) {
            send(502, {
              ok: false,
              error: String((error && error.message) || error),
            });
          }
        },
      }),
    "dsh-bilibili: play route",
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "prefix",
        path: MEDIA_PATH,
        handler: async (req, res) => {
          const fail = (status, text) => {
            if (!res.writableEnded) {
              res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
              res.end(text);
            }
          };
          if (!sameOrigin(req)) {
            fail(403, "forbidden origin");
            return;
          }
          if (req.method !== "GET" && req.method !== "HEAD") {
            fail(405, "method not allowed");
            return;
          }
          const target = new URL(req.url, "http://localhost").searchParams.get("u");
          if (!target) {
            fail(400, "missing u");
            return;
          }
          if (!isCdnUrl(target)) {
            fail(403, "forbidden host");
            return;
          }
          try {
            // Referer + UA are exactly what the CDN gates on. There is no
            // overall deadline here: it would abort the body of a 400 MB video
            // mid-stream. The abort below is for the client going away instead.
            const controller = new AbortController();
            res.on("close", () => controller.abort());
            const headers = { ...BILI_HEADERS };
            const range = req.headers.range;
            if (typeof range === "string" && range !== "") headers.Range = range;
            const upstream = await fetch(target, { headers, signal: controller.signal });
            const out = {
              "content-type": upstream.headers.get("content-type") || "video/mp4",
              "accept-ranges": "bytes",
            };
            const length = upstream.headers.get("content-length");
            if (length !== null) out["content-length"] = length;
            const contentRange = upstream.headers.get("content-range");
            if (contentRange !== null) out["content-range"] = contentRange;
            res.writeHead(upstream.status, out);
            if (req.method === "HEAD" || upstream.body === null) {
              res.end();
              return;
            }
            // Honour backpressure. Without the drain wait this loop pulls from
            // Bilibili as fast as the CDN sends, while the browser deliberately
            // pauses once it has buffered enough — so the video piles up in
            // THIS process's memory (measured: +140 MB while one 447 MB video
            // was open) and the resulting GC pressure is what makes playback
            // stutter.
            for await (const chunk of Readable.fromWeb(upstream.body)) {
              if (!res.write(chunk)) {
                await new Promise((resolve) => {
                  res.once("drain", resolve);
                  res.once("close", resolve);
                });
              }
            }
            res.end();
          } catch (error) {
            fail(502, "stream error: " + String((error && error.message) || error));
          }
        },
      }),
    "dsh-bilibili: media route",
  );
}

/**
 * The panel's other three sources: watch history, the default favourite folder,
 * and search. One prefix route because they share the guard, the error shape
 * and the card projection.
 */
function registerLibraryRoutes(ctx) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "prefix",
        path: LIBRARY_PREFIX,
        handler: async (req, res) => {
          const send = (status, body) => {
            res.writeHead(status, {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            });
            res.end(JSON.stringify(body));
          };
          if (!sameOrigin(req)) {
            send(403, { ok: false, error: "forbidden origin" });
            return;
          }
          if (req.method !== "GET") {
            send(405, { ok: false, error: "method not allowed" });
            return;
          }

          const at = new URL(req.url, "http://localhost");
          const asked = Number(at.searchParams.get("page"));
          const page = Math.min(
            FEED_MAX_CURSOR,
            Math.max(1, Number.isFinite(asked) ? Math.floor(asked) : 1),
          );
          try {
            if (at.pathname === LIBRARY_PREFIX + "/history") {
              const max = Number(at.searchParams.get("max"));
              const viewAt = Number(at.searchParams.get("viewAt"));
              const result = await fetchHistory({
                max: Number.isFinite(max) ? Math.floor(max) : 0,
                viewAt: Number.isFinite(viewAt) ? Math.floor(viewAt) : 0,
                business: at.searchParams.get("business") || "",
              });
              send(200, { ok: true, view: "history", ...result });
              return;
            }
            if (at.pathname === LIBRARY_PREFIX + "/fav") {
              const result = await fetchFavourites(page);
              send(200, { ok: true, view: "fav", page, ...result });
              return;
            }
            if (at.pathname === LIBRARY_PREFIX + "/search") {
              const keyword = String(at.searchParams.get("keyword") || "").trim();
              if (keyword === "") {
                send(400, { ok: false, error: "keyword is required" });
                return;
              }
              const result = await fetchSearch(keyword.slice(0, 60), page);
              send(200, { ok: true, view: "search", keyword, ...result });
              return;
            }
            send(404, { ok: false, error: "not found" });
          } catch (error) {
            send(502, {
              ok: false,
              error: String((error && error.message) || error),
            });
          }
        },
      }),
    "dsh-bilibili: library routes",
  );
}

export function apply(ctx) {
  registerSessionRoutes(ctx);
  registerLoginRoutes(ctx);
  registerFeedRoute(ctx);
  registerPlayRoutes(ctx);
  registerLibraryRoutes(ctx);
}
