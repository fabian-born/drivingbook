// ============================================================
// PDF export: logbook for one year
// Layout: summary per vehicle → trip table → audit log
// ============================================================

import PDFDocument from "pdfkit";
import { summarize } from "./distances.js";
import { DEFAULT_LANGUAGE, localeOf, translate } from "../i18n.js";

const FONT      = "Helvetica";
const FONT_BOLD = "Helvetica-Bold";
const GREY      = "#666666";
const ROW_FILL  = "#f2f2f2";

const kmFormat = locale => n => (n == null ? "–" : n.toLocaleString(locale));

// Summary per vehicle from loadYearTrips() – same calculation as dashboard and
// vehicle info (distance from the last odometer reading before the year, decreases count as 0)
export function vehicleSummary(trips, unassignedName = translate(DEFAULT_LANGUAGE, "pdf.unassigned")) {
  const groups = new Map();
  for (const t of trips) {
    const key = t.vehicle_id ?? null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  return [...groups.values()].map(groupTrips => {
    const first = groupTrips[0], last = groupTrips.at(-1);
    return {
      name:    first.vehicle_name || unassignedName,
      startKm: first.odometer_km - (first.distance ?? 0),
      endKm:   last.odometer_km,
      ...summarize(groupTrips).totals,
    };
  });
}

// Short description of an audit log entry
function describeAudit(entry, formatTs, tr, km) {
  const fmt = (field, value) => {
    if (value == null) return "–";
    if (field === "timestamp") return formatTs(value);
    if (field === "odometer_km") return `${km(value)} km`;
    if (field === "trip_type")   return tr(`tripType.${value}`);
    return String(value);
  };
  const labels = Object.fromEntries(
    ["odometer_km", "destination", "trip_type", "timestamp", "vehicle_id"].map(f => [f, tr(`pdf.field.${f}`)]));

  if (entry.action === "delete") {
    const o = entry.old_data;
    return tr("pdf.deleted", {
      date: fmt("timestamp", o.timestamp), km: fmt("odometer_km", o.odometer_km),
      type: fmt("trip_type", o.trip_type), destination: o.destination,
    });
  }
  const changes = Object.keys(labels)
    .filter(f => JSON.stringify(entry.old_data?.[f]) !== JSON.stringify(entry.new_data?.[f]))
    // Standard fonts have no "→" (WinAnsi), hence "»"
    .map(f => `${labels[f]}: ${fmt(f, entry.old_data?.[f])} » ${fmt(f, entry.new_data?.[f])}`);
  return changes.length ? changes.join("; ") : tr("pdf.savedWithoutChange");
}

// trips: from loadYearTrips() (with distance per trip)
export function renderYearPdf(stream, { year, username, trips, audit, timezone, language = DEFAULT_LANGUAGE }) {
  const tr     = (key, params) => translate(language, key, params);
  const locale = localeOf(language);
  const km     = kmFormat(locale);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4", margin: 40, bufferPages: true,
      info: { Title: tr("pdf.title", { year }), Author: username },
    });
    doc.on("error", reject);
    stream.on("finish", resolve);
    stream.on("error", reject);
    doc.pipe(stream);

    const formatTs = iso => new Date(iso).toLocaleString(locale, {
      timeZone: timezone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    });

    const left   = doc.page.margins.left;
    const width  = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom - 15;  // room for footer
    let y = doc.page.margins.top;

    // ── Table helpers ───────────────────────────────────────
    function drawRow(columns, cells, { bold = false, fill = null, onNewPage = null } = {}) {
      doc.font(bold ? FONT_BOLD : FONT).fontSize(8.5);
      const height = Math.max(...columns.map((c, i) =>
        doc.heightOfString(String(cells[i] ?? ""), { width: c.width - 6 }))) + 6;

      if (y + height > bottom()) {
        doc.addPage();
        y = doc.page.margins.top;
        onNewPage?.();
        doc.font(bold ? FONT_BOLD : FONT).fontSize(8.5);
      }
      if (fill) doc.rect(left, y, width, height).fill(fill).fillColor("black");

      let x = left;
      columns.forEach((c, i) => {
        doc.text(String(cells[i] ?? ""), x + 3, y + 3, { width: c.width - 6, align: c.align || "left" });
        x += c.width;
      });
      y += height;
    }

    function heading(text) {
      if (y + 40 > bottom()) { doc.addPage(); y = doc.page.margins.top; }
      y += 10;
      doc.font(FONT_BOLD).fontSize(12).fillColor("black").text(text, left, y);
      y = doc.y + 6;
    }

    // ── Header ──────────────────────────────────────────────
    doc.font(FONT_BOLD).fontSize(18).text(tr("pdf.title", { year }), left, y);
    doc.font(FONT).fontSize(10).fillColor(GREY)
      .text(tr("pdf.subtitle", { username, date: formatTs(new Date().toISOString()) }));
    doc.fillColor("black");
    y = doc.y + 10;

    const rows     = trips;
    const vehicles = vehicleSummary(trips, tr("pdf.unassigned"));

    if (rows.length === 0) {
      doc.font(FONT).fontSize(11).text(tr("pdf.noTrips", { year }), left, y);
    } else {
      // ── Summary per vehicle ───────────────────────────────
      heading(tr("pdf.summary"));
      const summaryCols = [
        { width: 95 }, { width: 55, align: "right" }, { width: 55, align: "right" },
        { width: 55, align: "right" }, { width: 80, align: "right" }, { width: 85, align: "right" },
        { width: width - 425, align: "right" },
      ];
      drawRow(summaryCols, ["vehicle", "startKm", "endKm", "totalKm", "privateKm", "businessKm", "commuteKm"]
        .map(k => tr(`pdf.summaryHeader.${k}`)), { bold: true, fill: ROW_FILL });
      for (const v of vehicles) {
        const total = v.total;
        const pct   = n => (total > 0 ? ` (${tr("pdf.percent", {
          value: ((n / total) * 100).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
        })})` : "");
        drawRow(summaryCols, [
          v.name, km(v.startKm), km(v.endKm), km(total),
          km(v.private) + pct(v.private), km(v.business) + pct(v.business),
          km(v.commute) + pct(v.commute),
        ]);
      }

      // ── Trips ─────────────────────────────────────────────
      heading(tr("pdf.trips"));
      const multiVehicle = vehicles.length > 1;
      const tripCols = [
        { width: 28, align: "right" }, { width: 78 }, { width: 58, align: "right" },
        { width: 48, align: "right" }, { width: 64 },
        ...(multiVehicle ? [{ width: 80 }] : []),
      ];
      tripCols.push({ width: width - tripCols.reduce((s, c) => s + c.width, 0) });

      const header = ["no", "date", "odometer", "distance", "tripType", ...(multiVehicle ? ["vehicle"] : []), "destination"]
        .map(k => tr(`pdf.tripHeader.${k}`));
      const drawHeader = () => drawRow(tripCols, header, { bold: true, fill: ROW_FILL });
      drawHeader();

      rows.forEach((t, i) => {
        drawRow(tripCols, [
          // Odometer decreases remain visible here as negative distance
          i + 1, formatTs(t.timestamp).replace(", ", " "), km(t.odometer_km), km(t.distance),
          tr(`tripType.${t.trip_type}`),
          ...(multiVehicle ? [t.vehicle_name || "–"] : []),
          t.edited ? `${t.destination} *` : t.destination,
        ], { fill: i % 2 ? ROW_FILL : null, onNewPage: drawHeader });
      });

      if (rows.some(t => t.edited)) {
        doc.font(FONT).fontSize(8).fillColor(GREY)
          .text(tr("pdf.editedNote"), left, y + 4);
        doc.fillColor("black");
        y = doc.y;
      }
    }

    // ── Audit log ───────────────────────────────────────────
    heading(tr("pdf.auditLog"));
    if (audit.length === 0) {
      doc.font(FONT).fontSize(9).text(tr("pdf.noAudit"), left, y);
    } else {
      const auditCols = [{ width: 85 }, { width: 50, align: "right" }, { width: width - 135 }];
      const drawAuditHeader = () => drawRow(auditCols, ["changedAt", "tripId", "change"].map(k => tr(`pdf.auditHeader.${k}`)), { bold: true, fill: ROW_FILL });
      drawAuditHeader();
      audit.forEach((a, i) => {
        drawRow(auditCols, [formatTs(a.changed_at), `#${a.trip_id}`, describeAudit(a, formatTs, tr, km)],
          { fill: i % 2 ? ROW_FILL : null, onNewPage: drawAuditHeader });
      });
    }

    // ── Footer with page numbers ────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const marginBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;  // otherwise text in the margin creates a new page
      doc.font(FONT).fontSize(8).fillColor(GREY).text(
        tr("pdf.footer", { year, page: i + 1, pages: range.count }),
        left, doc.page.height - 30, { width, align: "center" }
      );
      doc.page.margins.bottom = marginBottom;
    }

    doc.end();
  });
}
