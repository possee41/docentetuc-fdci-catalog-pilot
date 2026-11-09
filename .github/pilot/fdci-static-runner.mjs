var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// lib/fdci-static-catalog.ts
var fdci_static_catalog_exports = {};
__export(fdci_static_catalog_exports, {
  CATALOG_MAX_BYTES: () => CATALOG_MAX_BYTES,
  buildFdciCatalog: () => buildFdciCatalog,
  catalogHash: () => catalogHash,
  createFdciCatalogReader: () => createFdciCatalogReader,
  publicCatalogItem: () => publicCatalogItem,
  validateFdciCatalog: () => validateFdciCatalog
});
async function catalogHash(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (n) => n.toString(16).padStart(2, "0")).join("");
}
function publicCatalogItem(input) {
  const item = Object.fromEntries(fields.map((k) => [k, input[k]]));
  for (const key of fields) {
    const v = item[key];
    if (dates.has(key)) {
      if (v !== null && (typeof v !== "string" || !Number.isFinite(Date.parse(v)))) fail();
    } else if (typeof v !== "string" || v.length > (key === "summary" ? 2e3 : 500) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) fail();
  }
  if (!/^fdci:commission:[1-9]\d{0,11}$/.test(item.id) || item.id.split(":").at(-1) !== item.externalId || !item.title || !["ACTIVE", "UPCOMING", "CLOSED", "EXPIRED", "UNKNOWN"].includes(item.normalizedStatus)) fail();
  const url = new URL(item.officialUrl);
  if (url.protocol !== "https:" || url.hostname !== "capacitaciondocente.educaciontuc.gov.ar" || url.port || url.username || url.password || url.search || url.hash) fail();
  return item;
}
async function buildFdciCatalog(inputs, updatedAt, observations) {
  if (!iso(updatedAt) || inputs.length > 1e4) fail();
  const unique = /* @__PURE__ */ new Map();
  for (const input of inputs) {
    const item = publicCatalogItem(input), old = unique.get(item.id);
    if (old && JSON.stringify(old) !== JSON.stringify(item)) throw Error("FDCI_CATALOG_DUPLICATE_CONFLICT");
    unique.set(item.id, item);
  }
  const items = [...unique.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (observations && (!exact(observations, items.map((i) => i.id)) || items.some((i) => {
    const o = observations[i.id];
    return !o || !exact(o, ["checkedAt", "lastChangedAt"]) || !iso(o.checkedAt) || !iso(o.lastChangedAt) || o.lastChangedAt > o.checkedAt || o.checkedAt > updatedAt;
  }))) fail();
  const body = {
    schemaVersion: observations ? 2 : 1,
    source: "fdci",
    scope: "active",
    updatedAt,
    version: await catalogHash(items),
    items,
    ...observations ? { observations: Object.fromEntries(items.map((i) => [i.id, observations[i.id]])) } : {}
  };
  const result2 = { ...body, sha256: await catalogHash(body) };
  if (new TextEncoder().encode(JSON.stringify(result2)).byteLength > CATALOG_MAX_BYTES) fail();
  return result2;
}
async function validateFdciCatalog(value) {
  if (!value || typeof value !== "object") fail();
  const v = value;
  if (!exact(v, ["schemaVersion", "source", "scope", "updatedAt", "version", "items", "sha256", ...v.schemaVersion === 2 ? ["observations"] : []]) || ![1, 2].includes(v.schemaVersion) || v.schemaVersion === 2 && (!v.observations || typeof v.observations !== "object") || v.source !== "fdci" || v.scope !== "active" || !Array.isArray(v.items) || v.items.some((x) => !x || !exact(x, fields))) fail();
  const canonical = await buildFdciCatalog(v.items, v.updatedAt, v.observations);
  if (canonical.version !== v.version || canonical.sha256 !== v.sha256 || JSON.stringify(canonical.items) !== JSON.stringify(v.items)) fail();
  return canonical;
}
function createFdciCatalogReader(url, fetcher = fetch, now = () => Date.now(), statusUrl) {
  const target = new URL(url);
  if (target.origin !== "https://possee41.github.io" || target.username || target.password || target.search || target.hash || !target.pathname.endsWith("/catalog.json"))
    throw Error("FDCI_CATALOG_ORIGIN_FORBIDDEN");
  if (statusUrl && statusUrl !== new URL("status.json", target).href) throw Error("FDCI_STATUS_ORIGIN_FORBIDDEN");
  let lastGood;
  return async () => {
    let error;
    let incomplete = false;
    try {
      const response = await fetcher(target.href, { credentials: "omit", redirect: "error", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(1e4) });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw Error();
      const reader = response.body?.getReader();
      if (!reader) throw Error();
      let text2 = "", size = 0;
      const decoder = new TextDecoder("utf-8", { fatal: true });
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > CATALOG_MAX_BYTES) {
          await reader.cancel();
          throw Error();
        }
        text2 += decoder.decode(value, { stream: true });
      }
      const next = await validateFdciCatalog(JSON.parse(text2 + decoder.decode()));
      if (Date.parse(next.updatedAt) > now() + 3e5 || lastGood && (next.updatedAt < lastGood.updatedAt || next.updatedAt === lastGood.updatedAt && next.sha256 !== lastGood.sha256)) throw Error();
      if (statusUrl) {
        const statusResponse = await fetcher(statusUrl, { credentials: "omit", redirect: "error", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(1e4) });
        if (!statusResponse.ok || !statusResponse.headers.get("content-type")?.includes("application/json")) throw Error();
        const text3 = await statusResponse.text();
        if (text3.length > 4096) throw Error();
        const s = JSON.parse(text3);
        if (!exact(s, ["status", "updatedAt", "ageMs", "lastAttempt", "catalogSha256", "revision"]) || !["ready", "stale"].includes(s.status) || s.updatedAt !== next.updatedAt || s.catalogSha256 !== next.sha256 || !/^[a-f0-9]{40}$/.test(s.revision) || !s.lastAttempt || !exact(s.lastAttempt, ["at", "status", "error"]) || !iso(s.lastAttempt.at) || s.lastAttempt.at < next.updatedAt || Date.parse(s.lastAttempt.at) > now() + 3e5 || !["complete", "partial", "restarted", "source-error"].includes(s.lastAttempt.status)) throw Error();
        incomplete = s.lastAttempt.status !== "complete" || s.status === "stale";
      }
      lastGood = next;
    } catch {
      error = "FDCI_CATALOG_UNAVAILABLE";
    }
    const age = lastGood ? now() - Date.parse(lastGood.updatedAt) : Infinity;
    return {
      status: !lastGood ? "unavailable" : error || incomplete || age > 864e5 ? "stale" : "ready",
      ageMs: lastGood ? Math.max(0, age) : null,
      catalog: lastGood ? structuredClone(lastGood) : null,
      updatedAt: lastGood?.updatedAt ?? null,
      version: lastGood?.version ?? null,
      observations: structuredClone(lastGood?.observations ?? {}),
      // Return detached public DTOs; caller cannot corrupt last-known-good state.
      items: lastGood ? structuredClone(lastGood.items) : [],
      error
    };
  };
}
var CATALOG_MAX_BYTES, fields, fail, iso, exact, dates;
var init_fdci_static_catalog = __esm({
  "lib/fdci-static-catalog.ts"() {
    "use strict";
    CATALOG_MAX_BYTES = 2e6;
    fields = ["id", "externalId", "title", "summary", "category", "level", "area", "location", "character", "status", "normalizedStatus", "officialUrl", "registrationOpenAt", "registrationCloseAt", "startsAt", "endsAt", "sourceUpdatedAt"];
    fail = () => {
      throw Error("FDCI_CATALOG_INVALID");
    };
    iso = (v) => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
    exact = (v, keys) => Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
    dates = /* @__PURE__ */ new Set(["registrationOpenAt", "registrationCloseAt", "startsAt", "endsAt", "sourceUpdatedAt"]);
  }
});

// scripts/fdci-static-runner.mjs
import { execFileSync } from "node:child_process";
import { readFile as readFile4, writeFile as writeFile4, mkdir as mkdir4 } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// scripts/fdci-static-durable.mjs
import { createHash } from "node:crypto";
import { mkdir as mkdir3, readFile as readFile3, writeFile as writeFile3 } from "node:fs/promises";
import { join as join3 } from "node:path";
init_fdci_static_catalog();

// scripts/fdci-static-artifact.mjs
init_fdci_static_catalog();

// lib/circuits.ts
var TUCUMAN_CIRCUITS = [
  { id: "I", departments: ["Burruyac\xFA", "Cruz Alta", "Leales"] },
  { id: "II", departments: ["Capital", "San Miguel de Tucum\xE1n"] },
  { id: "III", departments: ["Trancas", "Yerba Buena", "Taf\xED Viejo", "Lules"] },
  { id: "IV", departments: ["Taf\xED del Valle", "Famaill\xE1", "Monteros", "Simoca"] },
  { id: "V", departments: ["Chicligasta", "R\xEDo Chico", "Juan Bautista Alberdi", "La Cocha", "Graneros"] }
];
var normalize = (value = "") => value.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
var circuitNumber = { i: "I", ii: "II", iii: "III", iv: "IV", v: "V", "1": "I", "2": "II", "3": "III", "4": "IV", "5": "V" };
var containsPhrase = (text2, phrase) => ` ${text2} `.includes(` ${normalize(phrase)} `);
function explicitCircuits(value) {
  const text2 = normalize(value), found = /* @__PURE__ */ new Set();
  const token = "(?:iv|iii|ii|i|v|[1-5])";
  const bareCircuitList = new RegExp(`^${token}(?:\\s*(?:,|y|e|;|\xB7)\\s*${token})*$`);
  const circuitLists = new RegExp(`\\bcircuit(?:o|os)\\s+(${token}(?:\\s*(?:,|y|e)\\s*${token})*)`, "g");
  if (bareCircuitList.test(text2)) {
    for (const item of text2.match(/iv|iii|ii|i|v|[1-5]/g) || []) {
      const id3 = circuitNumber[item];
      if (id3) found.add(id3);
    }
  }
  for (const match of text2.matchAll(circuitLists)) {
    for (const item of match[1].match(/iv|iii|ii|i|v|[1-5]/g) || []) {
      const id3 = circuitNumber[item];
      if (id3) found.add(id3);
    }
  }
  return [...found];
}
function departmentsIn(value) {
  const text2 = normalize(value), found = /* @__PURE__ */ new Set();
  for (const circuit of TUCUMAN_CIRCUITS) {
    if (circuit.departments.some((department) => containsPhrase(text2, department))) found.add(circuit.id);
  }
  return [...found];
}
var result = (sourceCircuitRaw, circuits, circuitInferenceSource) => ({
  sourceCircuitRaw,
  normalizedCircuit: circuits.length === 0 ? "UNKNOWN" : circuits.length === 1 ? circuits[0] : "MULTIPLE",
  circuits,
  circuitInferenceSource,
  circuitConfidence: circuitInferenceSource === "explicit" ? 100 : circuitInferenceSource === "department" ? 90 : circuitInferenceSource === "locality" ? 75 : 0
});
function inferCircuit(input) {
  const explicit = input.explicit?.trim() || "";
  const rawCircuits = explicitCircuits(explicit);
  if (rawCircuits.length) return result(explicit, rawCircuits, "explicit");
  if (/\b(todos? los circuitos|toda la provincia|provincial|para toda la provincia)\b/.test(normalize(explicit))) return { sourceCircuitRaw: explicit, normalizedCircuit: "ALL", circuits: [], circuitInferenceSource: "explicit", circuitConfidence: 100 };
  const department = input.department?.trim() || "";
  const fromDepartment = departmentsIn(department);
  if (fromDepartment.length) return result(department, fromDepartment, "department");
  const locality = input.locality?.trim() || "";
  const fromLocality = departmentsIn(locality);
  if (fromLocality.length) return result(locality, fromLocality, "locality");
  return result(explicit || department || locality, [], "unknown");
}

// lib/publication-lifecycle.ts
function publicationLifecycle(input) {
  const normalized = String(input.normalizedStatus || "").toUpperCase();
  const source = String(input.sourceStatus || "").toLowerCase();
  if (normalized === "REMOVED_FROM_SOURCE" || source === "removed_from_source") return "REMOVED_FROM_SOURCE";
  const now = (input.now || /* @__PURE__ */ new Date()).getTime();
  const dateStatus = String(input.dateStatus || "").toLowerCase();
  const certainDate = ["confirmed", "course_confirmed"].includes(dateStatus);
  if (dateStatus !== "tentative" && input.sourceStatusIsExplicit && /cerrad|finaliz|vencid|expired|closed/i.test(source)) return "CLOSED";
  if (dateStatus === "tentative" && input.sourceStatusIsExplicit && /abiert/i.test(source) && input.registrationOpenAt && Date.parse(input.registrationOpenAt) <= now && input.registrationCloseAt && Date.parse(input.registrationCloseAt) >= now) return "ACTIVE";
  if (["tentative", "general_window", "unknown"].includes(dateStatus)) return "UNKNOWN";
  const expiry = input.expiresAt ? Date.parse(input.expiresAt) : Number.NaN;
  if (Number.isFinite(expiry) && expiry < now) return "EXPIRED";
  const close = input.registrationCloseAt ? Date.parse(input.registrationCloseAt) : Number.NaN;
  if (Number.isFinite(close) && close < now) return "CLOSED";
  const open3 = input.registrationOpenAt ? Date.parse(input.registrationOpenAt) : Number.NaN;
  if (Number.isFinite(open3) && open3 > now && certainDate) return "UPCOMING";
  if (input.sourceStatusIsExplicit && /abiert|vigente|active|verificado/i.test(source)) return "ACTIVE";
  if (normalized === "ACTIVE" || normalized === "UPCOMING" || normalized === "CLOSED" || normalized === "EXPIRED") return normalized;
  return "UNKNOWN";
}

// lib/sync-diff.ts
async function hashSourceSnapshot(sourceData, derivedMetadata) {
  const payload = new TextEncoder().encode(JSON.stringify({ sourceData, derivedMetadata }));
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// lib/training.ts
var text = (value) => value == null ? "" : String(value);
var number = (value) => value == null || value === "" || Number.isNaN(Number(value)) ? void 0 : Number(value);
var localDateTime = (value, endOfDay = false) => {
  const raw = text(value).trim();
  if (!raw) return void 0;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T${endOfDay ? "23:59:59" : "00:00:00"}-03:00` : `${raw.replace(" ", "T")}${/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw) ? "" : "-03:00"}`;
  return Number.isFinite(Date.parse(normalized)) ? normalized : void 0;
};
var plainText = (value) => text(value).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&#(x[0-9a-f]+|\d+);/gi, (_match, digits) => {
  const point = Number.parseInt(digits[0].toLowerCase() === "x" ? digits.slice(1) : digits, digits[0].toLowerCase() === "x" ? 16 : 10);
  return point > 0 && point <= 1114111 ? String.fromCodePoint(point) : "";
}).replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
function trainingStatus(commission, now = /* @__PURE__ */ new Date()) {
  if (!commission) return "consultar";
  const time = now.getTime();
  const opens = localDateTime(commission.fecha_apertura_preinscripcion);
  const closes = localDateTime(commission.fecha_cierre_preinscripcion, true);
  const starts = localDateTime(commission.fecha_inicio);
  const finishes = localDateTime(commission.fecha_fin, true);
  const closed = Boolean(Number(commission.comision_cerrada));
  if (closed) return "inscripci\xF3n cerrada";
  if (opens && time < new Date(opens).getTime()) return "pr\xF3ximamente";
  if (opens && commission.isActivePre != null && !Boolean(Number(commission.isActivePre))) return "inscripci\xF3n cerrada";
  if (closes && time > new Date(closes).getTime()) return "inscripci\xF3n cerrada";
  if (opens && (closes || Boolean(Number(commission.isActivePre)))) return "inscripci\xF3n abierta";
  if (starts && time < new Date(starts).getTime()) return "consultar";
  if (starts && finishes && time <= new Date(finishes).getTime()) return "en curso";
  if (finishes && time > new Date(finishes).getTime()) return "finalizada";
  return "consultar";
}
function opportunity(course, commission, now = /* @__PURE__ */ new Date()) {
  const trainingId = text(commission?.capacitacion_id || course.capacitacion_id);
  const commissionId = commission?.id == null ? "" : text(commission.id);
  const token = text(course.token || commission?.token), slug = text(course.slug || commission?.slug);
  const rawOpening = commission?.fecha_apertura_preinscripcion;
  const registrationOpensAt = localDateTime(rawOpening);
  const registrationHasTime = /\d{1,2}:\d{2}/.test(text(rawOpening));
  const registrationClosesAt = localDateTime(commission?.fecha_cierre_preinscripcion, true);
  const courseStartsAt = localDateTime(commission?.fecha_inicio);
  const courseEndsAt = localDateTime(commission?.fecha_fin, true);
  const dateStatus = registrationOpensAt || registrationClosesAt ? "confirmed" : courseStartsAt || courseEndsAt ? "course_confirmed" : "unknown";
  const description = plainText(course.descripcion || commission?.descripcion);
  const content = plainText(course.contenido || commission?.contenido);
  const statedRecipients = description.match(/destinatarios\s*:\s*([^.]*)/i)?.[1]?.trim();
  const officialUrl = token && slug ? `https://capacitaciondocente.educaciontuc.gov.ar/capacitaciones/${token}/${slug}${commissionId ? `/${commissionId}` : ""}` : "https://capacitaciondocente.educaciontuc.gov.ar/capacitaciones";
  return {
    id: commissionId ? `fdci:commission:${commissionId}` : `fdci:course:${trainingId}`,
    externalId: commissionId || trainingId,
    title: text(course.nombre || commission?.nombre || "Capacitaci\xF3n docente"),
    summary: (description || content).slice(0, 2e3),
    level: text(course.niveles),
    area: text(course.areas || course.eje_prioritario),
    location: text(commission?.lugar),
    modality: text(course.modalidad || commission?.modalidad),
    startsAt: courseStartsAt || null,
    endsAt: registrationClosesAt || null,
    status: trainingStatus(commission, now),
    officialUrl,
    sourceUpdatedAt: text(commission?.updated_at) || null,
    metadata: {
      entity: commissionId ? "commission" : "course",
      trainingId,
      ...commissionId ? { commissionId } : {},
      ...registrationOpensAt ? { registrationOpensAt, registrationHasTime } : {},
      ...registrationClosesAt ? { registrationClosesAt } : {},
      preinscripcionFechaConfirmada: Boolean(registrationOpensAt),
      ...courseStartsAt ? { courseStartsAt } : {},
      ...courseEndsAt ? { courseEndsAt } : {},
      source: "FDCI Tucum\xE1n",
      sourceUrl: officialUrl,
      dateStatus,
      ...commission?.direccion ? { address: text(commission.direccion) } : {},
      ...number(commission?.cupo) != null ? { capacity: number(commission?.cupo) } : {},
      ...number(commission?.cupo_preinscripcion) != null ? { preCapacity: number(commission?.cupo_preinscripcion) } : {},
      ...number(commission?.cupo_disponible_pre) != null ? { availablePreCapacity: number(commission?.cupo_disponible_pre) } : {},
      ...number(course.horas_catedra) != null ? { hours: number(course.horas_catedra) } : {},
      ...number(commission?.cantidad_encuentros) != null ? { meetings: number(commission?.cantidad_encuentros) } : {},
      ...statedRecipients || [course.cargos, course.niveles, course.areas].filter(Boolean).length ? { recipients: statedRecipients || [course.cargos, course.niveles, course.areas].filter(Boolean).map(text).join(" \xB7 ") } : {},
      ...commission?.cronograma ? { schedule: plainText(commission.cronograma) } : {},
      ...content ? { content } : {},
      ...course.nombre_direccion || commission?.nombre_direccion ? { organization: text(course.nombre_direccion || commission?.nombre_direccion) } : {}
    },
    raw: { course, ...commission ? { commission } : {} }
  };
}
function mergeTrainingData(courses, commissions, now = /* @__PURE__ */ new Date()) {
  const byTraining = /* @__PURE__ */ new Map();
  for (const commission of commissions) {
    const id3 = text(commission.capacitacion_id);
    if (!id3) continue;
    byTraining.set(id3, [...byTraining.get(id3) || [], commission]);
  }
  const courseIds = new Set(courses.map((course) => text(course.capacitacion_id)));
  const result2 = courses.flatMap((course) => {
    const linked = byTraining.get(text(course.capacitacion_id)) || [];
    return linked.length ? linked.map((commission) => opportunity(course, commission, now)) : [opportunity(course, void 0, now)];
  });
  for (const commission of commissions) if (!courseIds.has(text(commission.capacitacion_id))) result2.push(opportunity(commission, commission, now));
  return [...new Map(result2.map((item) => [item.id, item])).values()];
}

// lib/fdci-import.ts
var FDCI_METADATA_LIMIT = 6e3;
function serializeFdciMetadata(value) {
  const full = JSON.stringify(value);
  if (full.length <= FDCI_METADATA_LIMIT || !value.content) return full;
  let lower = 0, upper = value.content.length, best = "";
  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    const candidate = JSON.stringify({ ...value, content: `${value.content.slice(0, middle)}\u2026` });
    if (candidate.length <= FDCI_METADATA_LIMIT) {
      best = candidate;
      lower = middle + 1;
    } else upper = middle - 1;
  }
  return best || full;
}
async function prepareFdciImports(courses, commissions, now = /* @__PURE__ */ new Date()) {
  return Promise.all(mergeTrainingData(courses, commissions, now).map(async (item) => {
    const metadata = serializeFdciMetadata(item.metadata);
    const inferred = inferCircuit({ locality: item.location });
    const sourceHash = await hashSourceSnapshot(item.raw, { metadata: item.metadata, status: item.status, startsAt: item.startsAt, endsAt: item.endsAt });
    const contentHash = await hashSourceSnapshot(sourceHash, { circuit: inferred.normalizedCircuit, raw: inferred.sourceCircuitRaw, via: inferred.circuitInferenceSource });
    const registrationOpenAt = item.metadata.registrationOpensAt || null;
    const registrationCloseAt = item.metadata.registrationClosesAt || null;
    const expiresAt = item.metadata.courseEndsAt || null;
    return {
      id: item.id,
      externalId: item.externalId,
      category: item.metadata.entity === "commission" ? `Comisi\xF3n #${item.metadata.commissionId}` : "Capacitaci\xF3n",
      title: item.title,
      summary: item.summary,
      level: item.level,
      area: item.area,
      location: item.location,
      character: item.modality,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      status: item.status,
      officialUrl: item.officialUrl,
      metadata,
      contentHash,
      sourceUpdatedAt: item.sourceUpdatedAt && Number.isFinite(Date.parse(item.sourceUpdatedAt)) ? item.sourceUpdatedAt : null,
      registrationOpenAt,
      registrationCloseAt,
      expiresAt,
      normalizedStatus: publicationLifecycle({ sourceStatus: item.status, sourceStatusIsExplicit: true, registrationOpenAt, registrationCloseAt, expiresAt, dateStatus: item.metadata.dateStatus, now }),
      circuit: inferred.normalizedCircuit,
      sourceCircuitRaw: inferred.sourceCircuitRaw,
      circuitInferenceSource: inferred.circuitInferenceSource,
      circuitConfidence: inferred.circuitConfidence
    };
  }));
}

// scripts/import-fdci.mjs
var pause = (ms) => new Promise((resolve3) => setTimeout(resolve3, ms));
async function requestJson(url, options = {}, fetcher = fetch) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetcher(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(2e4)]) : AbortSignal.timeout(2e4) });
    } catch (error) {
      if (attempt === 2 || options.signal?.aborted || ["FDCI_PROBE_REQUEST_LIMIT", "FDCI_CANCELLED", "FDCI_SOURCE_FORBIDDEN"].includes(error?.message)) throw error;
      await pause(300 * 2 ** attempt);
      continue;
    }
    if (response.ok) return response.json();
    if (![500, 502, 503, 504].includes(response.status) || attempt === 2) throw new Error(`HTTP_${response.status}`);
    await pause(300 * 2 ** attempt);
  }
  throw new Error("REQUEST_FAILED");
}

// scripts/fdci-static-catalog.mjs
init_fdci_static_catalog();
import { mkdir, open, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
async function publishLocalCatalog(catalog, directory, promote = rename) {
  const valid = await validateFdciCatalog(catalog);
  const dir = resolve(directory), versions = join(dir, "versions");
  await mkdir(versions, { recursive: true });
  const lockPath = join(dir, ".publish.lock"), lock = await open(lockPath, "wx");
  const tmp = join(dir, `.catalog-${randomUUID()}.tmp`);
  try {
    let previous;
    try {
      previous = await validateFdciCatalog(JSON.parse(await readFile(join(dir, "catalog.json"), "utf8")));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    if (previous && previous.updatedAt > valid.updatedAt) throw Error("FDCI_CATALOG_OLDER_THAN_CURRENT");
    if (previous?.updatedAt === valid.updatedAt && previous.sha256 !== valid.sha256) throw Error("FDCI_CATALOG_SAME_TIME_CONFLICT");
    const bytes = JSON.stringify(valid) + "\n", versionFile = join(versions, `${valid.sha256}.json`);
    await writeFile(tmp, bytes, { flag: "wx" });
    try {
      await writeFile(versionFile, bytes, { flag: "wx" });
    } catch (e) {
      if (e.code !== "EEXIST" || await readFile(versionFile, "utf8") !== bytes) throw e;
    }
    await promote(tmp, join(dir, "catalog.json"));
    return { version: valid.version, sha256: valid.sha256, items: valid.items.length };
  } finally {
    await rm(tmp, { force: true });
    await lock.close();
    await rm(lockPath);
  }
}

// scripts/fdci-incremental.mjs
var id = (value) => /^[1-9]\d{0,11}$/.test(String(value));
var fdciKey = (course, commission) => {
  if (!id(course) || !id(commission)) throw new Error("FDCI_SCHEMA_CHANGED");
  return `${String(course).padStart(12, "0")}:${String(commission).padStart(12, "0")}`;
};

// scripts/collect-fdci-delta.mjs
var root = "https://apicapacitaciones.educaciontuc.edu.ar/api";
var courseKey = (id3) => fdciKey(id3, 1).slice(0, 12);
async function collectFdciDeltaSlice(fetcher, { state, queued, courseLimit = 4, now = /* @__PURE__ */ new Date(), onInventory = async () => null }) {
  if (!Number.isSafeInteger(courseLimit) || courseLimit < 1 || courseLimit > 4) throw new Error("FDCI_DETAIL_LIMIT_INVALID");
  if (![state.detail_after, state.detail_upper].every((value) => typeof value === "string" && /^(?:\d{12})?$/.test(value)) || state.detail_after > state.detail_upper) throw new Error("FDCI_DELTA_CURSOR_INVALID");
  const active = await requestJson(`${root}/gestionCapas/getCapaActivas`, {}, fetcher);
  const courses = await requestJson(`${root}/gestionCapas/getRestoCapas`, {}, fetcher);
  if (!Array.isArray(active) || !Array.isArray(courses)) throw new Error("FDCI_SCHEMA_CHANGED");
  const commissions = /* @__PURE__ */ new Map();
  for (const c of active) {
    fdciKey(c?.capacitacion_id, c?.id);
    const previous = commissions.get(String(c.id));
    if (previous) throw new Error("FDCI_SCHEMA_CHANGED");
    commissions.set(String(c.id), c);
  }
  const parents = /* @__PURE__ */ new Map();
  const activeKeys = new Set([...commissions.values()].map((c) => courseKey(c.capacitacion_id)));
  const upcomingKeys = /* @__PURE__ */ new Set();
  for (const c of courses) {
    if (c?.proxima_fecha_preinscripcion) {
      const date = String(c.proxima_fecha_preinscripcion);
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(date)) throw new Error("FDCI_SCHEMA_CHANGED");
      const opening = Date.parse(date.replace(" ", "T") + "-03:00");
      if (!Number.isFinite(opening)) throw new Error("FDCI_SCHEMA_CHANGED");
      if (opening > now.getTime()) {
        const key2 = courseKey(c.capacitacion_id);
        activeKeys.add(key2);
        upcomingKeys.add(key2);
      }
    }
    if (!c || !activeKeys.has(String(c.capacitacion_id).padStart(12, "0"))) continue;
    const key = courseKey(c.capacitacion_id);
    if (parents.has(key)) throw new Error("FDCI_SCHEMA_CHANGED");
    parents.set(key, c);
  }
  const inventory = [...commissions.values()].map((c) => `commission:${c.capacitacion_id}:${c.id}`).concat([...upcomingKeys].map((key) => `upcoming:${key}:${parents.get(key).proxima_fecha_preinscripcion}`)).sort();
  state = await onInventory(inventory) || state;
  const keys = [...activeKeys].sort(), upper = state.detail_upper || keys.at(-1) || "";
  const after = state.detail_after || "";
  const pending = keys.filter((key) => key > after && key <= upper);
  const pinned = [...queued.values()].sort((a, b) => a.seq - b.seq).flatMap((row) => {
    const c = commissions.get(row.id.split(":").at(-1));
    return c ? [courseKey(c.capacitacion_id)] : [];
  });
  const selected = [...new Set(pinned)].slice(0, Math.min(2, courseLimit));
  for (const key of pending) {
    if (selected.length >= courseLimit) break;
    if (!selected.includes(key)) selected.push(key);
  }
  const completed = /* @__PURE__ */ new Set(), items = [];
  let budgetStop = false;
  for (const key of selected) {
    const course = parents.get(key);
    if (!course || !/^[A-Za-z0-9_-]{1,80}$/.test(course.token || "") || !/^[a-z0-9-]{1,160}$/.test(course.slug || ""))
      throw new Error("FDCI_DELTA_COLLECTION_INCOMPLETE");
    let detail;
    try {
      detail = await requestJson(`${root}/capa/getCupo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: course.token, slug: course.slug })
      }, fetcher);
    } catch (error) {
      if (error.message === "FDCI_PROBE_REQUEST_LIMIT") {
        budgetStop = true;
        break;
      }
      throw error;
    }
    if (!Array.isArray(detail?.comisiones)) throw new Error("FDCI_DELTA_COLLECTION_INCOMPLETE");
    const expected = [...commissions.values()].filter((c) => courseKey(c.capacitacion_id) === key);
    const matched = expected.map((c) => {
      const rows = detail.comisiones.filter((d) => String(d.id) === String(c.id) && String(d.capacitacion_id) === String(c.capacitacion_id));
      if (rows.length !== 1) throw new Error("FDCI_DELTA_COLLECTION_INCOMPLETE");
      return rows[0];
    });
    if (upcomingKeys.has(key)) {
      for (const row of detail.comisiones) {
        if (String(row.capacitacion_id) !== String(course.capacitacion_id)) throw new Error("FDCI_SCHEMA_CHANGED");
        fdciKey(row.capacitacion_id, row.id);
        if (!matched.some((c) => String(c.id) === String(row.id))) matched.push(row);
      }
      if (!matched.length) throw new Error("FDCI_DELTA_COLLECTION_INCOMPLETE");
    }
    if (new Set(matched.map((c) => String(c.id))).size !== matched.length) throw new Error("FDCI_SCHEMA_CHANGED");
    items.push(...await prepareFdciImports([course], matched, now));
    completed.add(key);
  }
  let next = after;
  for (const key of pending) {
    if (!completed.has(key)) break;
    next = key;
  }
  if (budgetStop && !items.length) throw new Error("FDCI_DELTA_COLLECTION_INCOMPLETE");
  const complete = !pending.some((key) => key > next);
  return {
    items,
    failures: 0,
    activeCommissions: commissions.size,
    detail: { after: next, upper, complete },
    coursesFetched: completed.size,
    pendingCourses: pending.filter((key) => key > next).length
  };
}

// scripts/fdci-static-cycle.mjs
init_fdci_static_catalog();
import { mkdir as mkdir2, open as open2, readFile as readFile2, writeFile as writeFile2, rename as rename2, rm as rm2 } from "node:fs/promises";
import { resolve as resolve2, join as join2, relative, isAbsolute, sep } from "node:path";
import { randomUUID as randomUUID2 } from "node:crypto";
var fresh = (history) => ({
  schemaVersion: 1,
  activeKey: null,
  state: { detail_after: "", detail_upper: "", detail_cycle: 1 },
  items: [],
  observations: {},
  history,
  lastCheckAt: null
});
async function saveCheckpoint(path2, data) {
  const temp = path2 + "." + randomUUID2() + ".tmp";
  try {
    await writeFile2(temp, JSON.stringify({ data, sha256: await catalogHash(data) }) + "\n", { flag: "wx" });
    await rename2(temp, path2);
  } finally {
    await rm2(temp, { force: true });
  }
}
async function runFdciStaticCycle({ workDirectory, publishDirectory, fetcher, checkedAt, courseLimit = 4, pause: pause2 = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  if (typeof fetcher !== "function" || new Date(checkedAt).toISOString() !== checkedAt) throw Error("STATIC_CYCLE_CONFIG_INVALID");
  const work = resolve2(workDirectory), output = resolve2(publishDirectory), rel = relative(output, work);
  if (!rel || !isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep)) throw Error("CHECKPOINT_MUST_NOT_BE_PUBLIC");
  await mkdir2(work, { recursive: true });
  const lockPath = join2(work, ".cycle.lock"), lock = await open2(lockPath, "wx"), path2 = join2(work, "checkpoint.json");
  let requests = 0;
  try {
    let previous = fresh({});
    try {
      const envelope2 = JSON.parse(await readFile2(path2, "utf8"));
      if (await catalogHash(envelope2.data) !== envelope2.sha256 || envelope2.data?.schemaVersion !== 1) throw Error("CHECKPOINT_INVALID");
      previous = envelope2.data;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    if (previous.lastCheckAt && checkedAt <= previous.lastCheckAt) throw Error("CHECKPOINT_TIME_CONFLICT");
    let activeKey;
    let slice;
    slice = await collectFdciDeltaSlice(async (url, options) => {
      const u = new URL(url);
      if (u.origin !== "https://apicapacitaciones.educaciontuc.edu.ar" || u.search || !["/api/gestionCapas/getCapaActivas", "/api/gestionCapas/getRestoCapas", "/api/capa/getCupo"].includes(u.pathname)) throw Error("FDCI_SOURCE_FORBIDDEN");
      if (requests >= 6) throw Error("FDCI_PROBE_REQUEST_LIMIT");
      requests++;
      if (requests > 1) await pause2(400);
      const response = await fetcher(url, { ...options, redirect: "error", credentials: "omit" });
      return response;
    }, {
      state: previous.state,
      queued: /* @__PURE__ */ new Map(),
      courseLimit,
      now: new Date(checkedAt),
      onInventory: async (inventory) => {
        activeKey = await catalogHash(inventory);
        if (previous.activeKey && previous.activeKey !== activeKey) {
          previous = fresh(previous.history);
        }
        return previous.state;
      }
    });
    const items = new Map(previous.items.map((i) => [i.id, i]));
    const observations = { ...previous.observations }, history = { ...previous.history };
    for (const row of slice.items) {
      const item = publicCatalogItem(row), hash2 = await catalogHash(item), old = history[item.id];
      const lastChangedAt = old?.hash === hash2 ? old.lastChangedAt : checkedAt;
      items.set(item.id, item);
      observations[item.id] = { checkedAt, lastChangedAt };
      history[item.id] = { hash: hash2, lastChangedAt };
    }
    const next = {
      ...previous,
      activeKey,
      lastCheckAt: checkedAt,
      items: [...items.values()],
      observations,
      history,
      state: {
        detail_after: slice.detail.complete ? "" : slice.detail.after,
        detail_upper: slice.detail.complete ? "" : slice.detail.upper,
        detail_cycle: previous.state.detail_cycle + Number(slice.detail.complete)
      }
    };
    if (!slice.detail.complete) {
      await saveCheckpoint(path2, next);
      return { status: "partial", requests, published: false, pending: slice.pendingCourses, cursor: next.state };
    }
    const publishable = [...items.values()].filter((item) => ["ACTIVE", "UPCOMING"].includes(item.normalizedStatus));
    const visibleObservations = Object.fromEntries(publishable.map((item) => [item.id, observations[item.id]]));
    const catalog = await buildFdciCatalog(publishable, checkedAt, visibleObservations);
    const result2 = await publishLocalCatalog(catalog, output);
    await saveCheckpoint(path2, { ...fresh(history), lastCheckAt: checkedAt });
    return { status: "complete", requests, published: true, ...result2 };
  } finally {
    await lock.close();
    await rm2(lockPath);
  }
}

// scripts/fdci-static-artifact.mjs
var exact2 = (o, keys) => o && typeof o === "object" && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
var id2 = /^fdci:commission:[1-9]\d{0,11}$/;
var hash = /^[a-f0-9]{64}$/;
var localOrigin = { dataset: "synthetic", repository: "local", workflowId: 0, runId: 0, runAttempt: 0, sha: "0".repeat(40), branch: "local" };
async function validateFdciCheckpoint(envelope2) {
  const d = envelope2?.data;
  if (!exact2(envelope2, ["data", "sha256"]) || await catalogHash(d) !== envelope2.sha256 || !exact2(d, ["schemaVersion", "activeKey", "state", "items", "observations", "history", "lastCheckAt"]) || d.schemaVersion !== 1 || d.activeKey !== null && !hash.test(d.activeKey) || !exact2(d.state, ["detail_after", "detail_upper", "detail_cycle"]) || ![d.state.detail_after, d.state.detail_upper].every((x) => typeof x === "string" && /^(\d{12})?$/.test(x)) || d.state.detail_after > d.state.detail_upper || !Number.isSafeInteger(d.state.detail_cycle) || d.state.detail_cycle < 1 || !d.history || typeof d.history !== "object") throw Error("STATIC_CHECKPOINT_INVALID");
  if (!Array.isArray(d.items) || d.items.some((i) => !exact2(i, Object.keys(publicCatalogItem(i))))) throw Error("STATIC_CHECKPOINT_FIELDS_INVALID");
  await buildFdciCatalog(d.items, d.lastCheckAt, d.observations);
  for (const [key, value] of Object.entries(d.history)) {
    if (!id2.test(key) || !exact2(value, ["hash", "lastChangedAt"]) || !hash.test(value.hash) || new Date(value.lastChangedAt).toISOString() !== value.lastChangedAt || value.lastChangedAt > d.lastCheckAt) throw Error("STATIC_HISTORY_INVALID");
  }
  return envelope2;
}

// scripts/fdci-static-durable.mjs
var FDCI_STATE_REPOSITORY = "possee41/docentetuc-fdci-catalog-pilot";
var FDCI_STATE_BRANCH = "fdci-static-state";
var path = "fdci-state.json";
var limit = 8e6;
var hex = /^[a-f0-9]{40}$/;
var exact3 = (v, keys) => v && typeof v === "object" && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
var iso2 = (v) => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
var blobSha = (bytes) => createHash("sha1").update(`blob ${Buffer.byteLength(bytes)}\0`).update(bytes).digest("hex");
async function envelope(data) {
  return { data, sha256: await catalogHash(data) };
}
async function initialFdciState(codeSha) {
  if (!hex.test(codeSha)) throw Error("FDCI_STATE_CODE_INVALID");
  return envelope({
    format: 1,
    repository: FDCI_STATE_REPOSITORY,
    dataset: "official",
    codeSha,
    generation: 0,
    checkpoint: null,
    catalog: null,
    lastAttempt: null
  });
}
async function validateDurableFdciState(value) {
  const d = value?.data;
  if (Buffer.byteLength(JSON.stringify(value) ?? "") > limit || !exact3(value, ["data", "sha256"]) || !exact3(d, ["format", "repository", "dataset", "codeSha", "generation", "checkpoint", "catalog", "lastAttempt"]) || value.sha256 !== await catalogHash(d) || d.format !== 1 || d.repository !== FDCI_STATE_REPOSITORY || d.dataset !== "official" || !hex.test(d.codeSha) || !Number.isSafeInteger(d.generation) || d.generation < 0) throw Error("FDCI_DURABLE_STATE_INVALID");
  if (d.generation === 0) {
    if (d.checkpoint !== null || d.catalog !== null || d.lastAttempt !== null) throw Error("FDCI_INITIAL_STATE_INVALID");
  } else {
    const a = d.lastAttempt;
    if (!exact3(a, ["at", "status", "error"]) || !iso2(a.at) || !["complete", "partial", "restarted", "source-error"].includes(a.status) || (a.status === "source-error" ? !/^[A-Z0-9_]{1,100}$/.test(a.error) : a.error !== null)) throw Error("FDCI_ATTEMPT_INVALID");
    if (d.checkpoint) {
      await validateFdciCheckpoint(d.checkpoint);
      if (d.checkpoint.data.lastCheckAt > a.at) throw Error("FDCI_STATE_TIME_INVALID");
    } else if (a.status !== "source-error") throw Error("FDCI_STATE_CHECKPOINT_MISSING");
    if (d.catalog) {
      await validateFdciCatalog(d.catalog);
      if (d.catalog.updatedAt > a.at) throw Error("FDCI_STATE_TIME_INVALID");
    }
    if (a.status === "complete" && (!d.catalog || d.catalog.updatedAt !== a.at || d.checkpoint.data.items.length || d.checkpoint.data.state.detail_after || d.checkpoint.data.state.detail_upper)) throw Error("FDCI_COMPLETE_STATE_INVALID");
  }
  return value;
}
function fdciDurableView(state, now = Date.now()) {
  const { catalog, lastAttempt } = state.data;
  const ageMs = catalog ? Math.max(0, now - Date.parse(catalog.updatedAt)) : null;
  const status = !catalog ? "unavailable" : lastAttempt?.status !== "complete" || ageMs > 864e5 ? "stale" : "ready";
  const activeItems = status === "ready" ? catalog.items.filter((i) => !["CLOSED", "EXPIRED"].includes(i.normalizedStatus) && ![i.registrationCloseAt, i.endsAt].some((d) => d && Date.parse(d) <= now)) : [];
  return {
    status,
    updatedAt: catalog?.updatedAt ?? null,
    ageMs,
    lastAttempt: structuredClone(lastAttempt),
    catalog: structuredClone(catalog),
    activeItems: structuredClone(activeItems)
  };
}
async function collectDurableFdciCycle({ state, root: root2, fetcher, checkedAt, pause: pause2 }) {
  await validateDurableFdciState(state);
  if (!iso2(checkedAt) || state.data.lastAttempt && checkedAt <= state.data.lastAttempt.at) throw Error("FDCI_STATE_TIME_CONFLICT");
  await mkdir3(root2);
  await mkdir3(join3(root2, "private"));
  if (state.data.checkpoint) await writeFile3(join3(root2, "private/checkpoint.json"), JSON.stringify(state.data.checkpoint));
  if (state.data.catalog) {
    await mkdir3(join3(root2, "public"));
    await writeFile3(join3(root2, "public/catalog.json"), JSON.stringify(state.data.catalog));
  }
  let result2, error = null, checkpoint = state.data.checkpoint, catalog = state.data.catalog;
  try {
    result2 = await runFdciStaticCycle({ workDirectory: join3(root2, "private"), publishDirectory: join3(root2, "public"), fetcher, checkedAt, pause: pause2, courseLimit: 2 });
    checkpoint = JSON.parse(await readFile3(join3(root2, "private/checkpoint.json"), "utf8"));
    if (result2.status === "complete") {
      catalog = await validateFdciCatalog(JSON.parse(await readFile3(join3(root2, "public/catalog.json"), "utf8")));
      if (catalog.sha256 !== result2.sha256) throw Error("FDCI_CATALOG_ACK_MISMATCH");
    }
  } catch (e) {
    error = /^[A-Z0-9_]{1,100}$/.test(e.message) ? e.message : "FDCI_SOURCE_FAILED";
    checkpoint = state.data.checkpoint;
    catalog = state.data.catalog;
  }
  const next = await envelope({
    ...state.data,
    generation: state.data.generation + 1,
    checkpoint,
    catalog,
    lastAttempt: { at: checkedAt, status: error ? "source-error" : result2.status, error }
  });
  await validateDurableFdciState(next);
  return { state: next, result: result2 ?? null, error, view: fdciDurableView(next, Date.parse(checkedAt)) };
}
function createFdciGitStateStore({ token, fetcher = fetch }) {
  if (!token) throw Error("FDCI_GITHUB_AUTH_REQUIRED");
  const base = `https://api.github.com/repos/${FDCI_STATE_REPOSITORY}`;
  const endpoint = `/contents/${path}`;
  const request = (route, method = "GET", body) => fetcher(base + route, {
    method,
    redirect: "error",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.object+json", "User-Agent": "DocenteTuc-FDCI-state" },
    body: body ? JSON.stringify(body) : void 0,
    signal: AbortSignal.timeout(3e4)
  });
  async function load() {
    const response = await request(`${endpoint}?ref=${FDCI_STATE_BRANCH}`);
    if (!response.ok) throw Error(response.status === 404 ? "FDCI_DURABLE_STATE_MISSING" : `FDCI_STATE_READ_HTTP_${response.status}`);
    let item = await response.json();
    const revision = item.sha;
    if (!hex.test(revision) || !Number.isSafeInteger(item.size) || item.size < 0 || item.size > limit || item.path !== path || item.type !== "file") throw Error("FDCI_STATE_METADATA_INVALID");
    if (item.encoding === "none") {
      const blob = await request(`/git/blobs/${revision}`);
      if (!blob.ok) throw Error(`FDCI_STATE_BLOB_HTTP_${blob.status}`);
      item = await blob.json();
    }
    if (item.encoding !== "base64" || typeof item.content !== "string") throw Error("FDCI_STATE_ENCODING_INVALID");
    const bytes = Buffer.from(item.content, "base64");
    if (bytes.length > limit || blobSha(bytes) !== revision) throw Error("FDCI_STATE_BLOB_MISMATCH");
    return { revision, state: await validateDurableFdciState(JSON.parse(bytes.toString("utf8"))) };
  }
  async function save(previous, state) {
    await validateDurableFdciState(previous.state);
    await validateDurableFdciState(state);
    if (!hex.test(previous.revision) || state.data.generation !== previous.state.data.generation + 1 || state.data.codeSha !== previous.state.data.codeSha || state.data.lastAttempt.at <= (previous.state.data.lastAttempt?.at ?? "")) throw Error("FDCI_STATE_TRANSITION_INVALID");
    if (state.data.lastAttempt.status !== "complete" && JSON.stringify(state.data.catalog) !== JSON.stringify(previous.state.data.catalog) || state.data.lastAttempt.status === "source-error" && JSON.stringify(state.data.checkpoint) !== JSON.stringify(previous.state.data.checkpoint)) throw Error("FDCI_PARTIAL_PROMOTION_FORBIDDEN");
    const content = JSON.stringify(state) + "\n", proposed = blobSha(content);
    const confirm = async () => {
      const confirmed = await load();
      if (confirmed.revision === proposed) return { ...confirmed, recoveredAck: true };
      throw Error("FDCI_STATE_COMMIT_UNCERTAIN");
    };
    let response;
    try {
      response = await request(endpoint, "PUT", {
        branch: FDCI_STATE_BRANCH,
        sha: previous.revision,
        message: `FDCI state ${state.data.generation} (${state.data.lastAttempt.status})`,
        content: Buffer.from(content).toString("base64")
      });
    } catch {
      return confirm();
    }
    if (!response.ok) throw Error([409, 422].includes(response.status) ? "FDCI_STATE_CONFLICT" : `FDCI_STATE_WRITE_HTTP_${response.status}`);
    let result2;
    try {
      result2 = await response.json();
    } catch {
      return confirm();
    }
    if (result2.content?.sha !== proposed) throw Error("FDCI_STATE_COMMIT_UNCERTAIN");
    return { revision: proposed, state, recoveredAck: false };
  }
  return { load, save };
}

// scripts/fdci-static-publisher.mjs
import { createHash as createHash2 } from "node:crypto";
init_fdci_static_catalog();

// lib/fdci-static-publication.ts
init_fdci_static_catalog();
var exact4 = (v, keys) => Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
var iso3 = (v) => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
async function validateFdciActiveVersion(value) {
  if (!value || typeof value !== "object") throw Error("FDCI_ACTIVE_INVALID");
  const v = value, { sha256, ...body } = v;
  if (!exact4(v, ["format", "source", "scope", "generation", "stateChecksum", "stateRevision", "codeSha", "catalogSha256", "catalogUpdatedAt", "versionPath", "lastAttempt", "sha256"]) || v.format !== 1 || v.source !== "fdci" || v.scope !== "active" || !Number.isSafeInteger(v.generation) || v.generation < 1 || !/^[a-f0-9]{64}$/.test(v.stateChecksum) || !/^[a-f0-9]{40}$/.test(v.stateRevision) || !/^[a-f0-9]{40}$/.test(v.codeSha) || !/^[a-f0-9]{64}$/.test(v.catalogSha256) || v.versionPath !== `versions/${v.catalogSha256}.json` || !iso3(v.catalogUpdatedAt) || !v.lastAttempt || !exact4(v.lastAttempt, ["at", "status", "error"]) || !iso3(v.lastAttempt.at) || v.lastAttempt.at < v.catalogUpdatedAt || !["complete", "partial", "restarted", "source-error"].includes(v.lastAttempt.status) || (v.lastAttempt.status === "source-error" ? !/^[A-Z0-9_]{1,100}$/.test(v.lastAttempt.error ?? "") : v.lastAttempt.error !== null) || sha256 !== await catalogHash(body)) throw Error("FDCI_ACTIVE_INVALID");
  return v;
}
async function buildFdciActiveVersion(input) {
  const body = { format: 1, source: "fdci", scope: "active", ...input, versionPath: `versions/${input.catalogSha256}.json` };
  return validateFdciActiveVersion({ ...body, sha256: await catalogHash(body) });
}

// scripts/fdci-static-publisher.mjs
var pointerPath = "fdci-catalog/active.json";
var hex2 = /^[a-f0-9]{40}$/;
var gitSha = (bytes) => createHash2("sha1").update(`blob ${Buffer.byteLength(bytes)}\0`).update(bytes).digest("hex");
function createFdciGitPublisher({ token, fetcher = fetch }) {
  if (!token) throw Error("FDCI_GITHUB_AUTH_REQUIRED");
  const base = `https://api.github.com/repos/${FDCI_STATE_REPOSITORY}`;
  const request = (route, method = "GET", body) => fetcher(base + route, {
    method,
    redirect: "error",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.object+json", "User-Agent": "DocenteTuc-FDCI-publication" },
    body: body ? JSON.stringify(body) : void 0,
    signal: AbortSignal.timeout(3e4)
  });
  async function read(path2) {
    if (path2 !== pointerPath && !/^fdci-catalog\/versions\/[a-f0-9]{64}\.json$/.test(path2)) throw Error("FDCI_PUBLICATION_PATH_FORBIDDEN");
    const response = await request(`/contents/${path2}?ref=main`);
    if (response.status === 404) return null;
    if (!response.ok) throw Error(`FDCI_PUBLICATION_READ_HTTP_${response.status}`);
    let value = await response.json();
    const revision = value.sha;
    if (value.type !== "file" || value.path !== path2 || !hex2.test(revision) || !Number.isSafeInteger(value.size) || value.size < 0 || value.size > 21e5) throw Error("FDCI_PUBLICATION_METADATA_INVALID");
    if (value.encoding === "none") {
      const blob = await request(`/git/blobs/${revision}`);
      if (!blob.ok) throw Error(`FDCI_PUBLICATION_BLOB_HTTP_${blob.status}`);
      value = await blob.json();
    }
    if (value.encoding !== "base64" || typeof value.content !== "string") throw Error("FDCI_PUBLICATION_ENCODING_INVALID");
    const bytes = Buffer.from(value.content, "base64");
    if (bytes.length > 21e5 || gitSha(bytes) !== revision) throw Error("FDCI_PUBLICATION_BLOB_MISMATCH");
    return { revision, bytes, value: JSON.parse(bytes.toString("utf8")) };
  }
  async function write(path2, value, previous) {
    const bytes = JSON.stringify(value) + "\n", proposed = gitSha(bytes);
    const confirm = async () => {
      const current = await read(path2);
      if (current?.revision === proposed) return { revision: proposed, recoveredAck: true };
      throw Error("FDCI_PUBLICATION_COMMIT_UNCERTAIN");
    };
    let response;
    try {
      response = await request(`/contents/${path2}`, "PUT", {
        branch: "main",
        message: `FDCI static ${path2 === pointerPath ? "active reference" : "immutable version"}`,
        content: Buffer.from(bytes).toString("base64"),
        ...previous ? { sha: previous.revision } : {}
      });
    } catch {
      return confirm();
    }
    if (!response.ok) {
      if (!previous && [409, 422].includes(response.status)) return confirm();
      throw Error([409, 422].includes(response.status) ? "FDCI_PUBLICATION_CONFLICT" : `FDCI_PUBLICATION_WRITE_HTTP_${response.status}`);
    }
    let result2;
    try {
      result2 = await response.json();
    } catch {
      return confirm();
    }
    if (result2.content?.sha !== proposed) throw Error("FDCI_PUBLICATION_COMMIT_UNCERTAIN");
    return { revision: proposed, recoveredAck: false };
  }
  async function reconcile(saved) {
    await validateDurableFdciState(saved.state);
    if (!hex2.test(saved.revision)) throw Error("FDCI_STATE_REVISION_INVALID");
    const { catalog, generation, codeSha, lastAttempt } = saved.state.data;
    const previous = await read(pointerPath);
    if (!catalog) {
      if (previous) throw Error("FDCI_STATE_CATALOG_MISSING");
      return { changed: false, active: null };
    }
    await validateFdciCatalog(catalog);
    const active = await buildFdciActiveVersion({
      generation,
      codeSha,
      lastAttempt,
      stateChecksum: saved.state.sha256,
      stateRevision: saved.revision,
      catalogSha256: catalog.sha256,
      catalogUpdatedAt: catalog.updatedAt
    });
    if (previous) {
      const current = await validateFdciActiveVersion(previous.value);
      if (current.generation > generation || current.generation === generation && current.sha256 !== active.sha256 || current.catalogUpdatedAt > catalog.updatedAt)
        throw Error("FDCI_PUBLICATION_STALE_STATE");
    }
    const path2 = `fdci-catalog/${active.versionPath}`, version = await read(path2);
    if (version) {
      await validateFdciCatalog(version.value);
      if (version.value.sha256 !== catalog.sha256 || version.bytes.toString("utf8") !== JSON.stringify(catalog) + "\n") throw Error("FDCI_IMMUTABLE_VERSION_CONFLICT");
    } else await write(path2, catalog, null);
    if (previous?.value.sha256 === active.sha256) return { changed: !version, active, revision: previous.revision, repairedVersion: !version };
    const committed = await write(pointerPath, active, previous);
    return { changed: true, active, ...committed };
  }
  return { reconcile };
}

// scripts/fdci-static-runner.mjs
async function runIntegratedFdci({ store, publisher, codeSha, root: root2, sourceFetch, checkedAt, pause: pause2, recoverOnly = true }) {
  const previous = await store.load();
  if (previous.state.data.codeSha !== codeSha) throw Error("FDCI_STATE_CODE_REVIEW_REQUIRED");
  const recovered = await publisher.reconcile(previous);
  if (recoverOnly || recovered.changed) return { status: "publication-reconciled", collected: false, publication: recovered };
  const outcome = await collectDurableFdciCycle({ state: previous.state, root: root2, fetcher: sourceFetch, checkedAt, pause: pause2 });
  const saved = await store.save(previous, outcome.state);
  const publication = await publisher.reconcile(saved);
  return {
    status: outcome.error ? "source-error" : outcome.result.status,
    collected: true,
    result: outcome.result,
    error: outcome.error,
    stateGeneration: saved.state.data.generation,
    publication
  };
}
async function reviewFdciExecutable(bytes, { expectedRevision, expectedChecksum, oldCodeSha, newCodeSha }) {
  const { createHash: createHash3 } = await import("node:crypto");
  const revision = createHash3("sha1").update(`blob ${Buffer.byteLength(bytes)}\0`).update(bytes).digest("hex");
  const state = await validateDurableFdciState(JSON.parse(bytes));
  if (revision !== expectedRevision || state.sha256 !== expectedChecksum || state.data.codeSha !== oldCodeSha || oldCodeSha === newCodeSha)
    throw Error("FDCI_CODE_REVIEW_PROVENANCE_INVALID");
  await initialFdciState(newCodeSha);
  const { catalogHash: catalogHash2 } = await Promise.resolve().then(() => (init_fdci_static_catalog(), fdci_static_catalog_exports));
  const data = { ...state.data, codeSha: newCodeSha, generation: state.data.generation + 1 };
  return validateDurableFdciState({ data, sha256: await catalogHash2(data) });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "review-local") {
    const [input, output, expectedRevision, expectedChecksum, oldCodeSha, newCodeSha] = process.argv.slice(3);
    const reviewed = await reviewFdciExecutable(await readFile4(input, "utf8"), { expectedRevision, expectedChecksum, oldCodeSha, newCodeSha });
    await writeFile4(output, JSON.stringify(reviewed) + "\n", { flag: "wx" });
  } else if (process.argv[2] === "run") {
    const codeSha = process.env.FDCI_STATIC_APPROVED_SHA;
    if (process.env.GITHUB_REPOSITORY !== FDCI_STATE_REPOSITORY || process.env.GITHUB_REF_NAME !== "main" || process.env.GITHUB_RUN_ATTEMPT !== "1" || process.env.FDCI_INTEGRATED_ENABLED !== "true" || !/^[a-f0-9]{40}$/.test(codeSha ?? "")) throw Error("FDCI_INTEGRATED_RUN_DISABLED");
    const actual = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
    if (actual !== codeSha) throw Error("FDCI_EXECUTABLE_SHA_MISMATCH");
    const token = process.env.GH_TOKEN;
    const result2 = await runIntegratedFdci({
      store: createFdciGitStateStore({ token }),
      publisher: createFdciGitPublisher({ token }),
      codeSha,
      root: ".fdci-integrated-runner",
      sourceFetch: fetch,
      checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
      recoverOnly: process.env.FDCI_RECOVER_ONLY !== "false"
    });
    await mkdir4("fdci-integrated-result");
    await writeFile4("fdci-integrated-result/result.json", JSON.stringify(result2) + "\n");
    console.log(JSON.stringify(result2));
    if (result2.error) process.exitCode = 1;
  } else throw Error("FDCI_INTEGRATED_OPERATION_INVALID");
}
export {
  reviewFdciExecutable,
  runIntegratedFdci
};
