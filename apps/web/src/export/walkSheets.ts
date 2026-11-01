import { jsPDF } from 'jspdf';
import { exportableState } from '../state/store';
import { byOrder, formatEightCount, formatTimecode } from '../state/interpolate';
import { safeFilename } from './filename';
import { ensureCjkFont, hasCjk } from './pdfFont';
import { messages } from '../i18n';

// A4 landscape, millimeters — same sheet conventions as pdf.ts.
const PAGE_W = 297;
const PAGE_H = 210;
const MARGIN = 16;
const HEADER_H = 20;

const INK = '#26221e';
const DIM = '#8a8074';

/**
 * Personal walk sheets: one page per performer with THEIR positions across
 * the whole show — a numbered route on the stage plan plus a table of
 * formation, time window, position, and facing. The printable handout each
 * dancer rehearses from. When any text is CJK the bundled Noto Sans TC
 * subset is embedded so Chinese names print instead of being skipped.
 */
export async function exportWalkSheetsPdf(): Promise<void> {
  const s = exportableState();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  const allText = [
    s.performance.title,
    ...s.performers.flatMap((p) => [p.name, p.role, p.badge ?? '']),
    ...s.formations.map((f) => f.name),
  ].join('');
  const font = await ensureCjkFont(doc, hasCjk(allText));
  drawWalkSheetsInto(doc, font);
  doc.save(`${safeFilename(s.performance.title)}-walk-sheets.pdf`);
}

/**
 * Draw one sheet per performer starting on the CURRENT page (the rehearsal
 * pack composes this after the charts; the standalone export calls it on a
 * fresh doc). The font must already be registered via ensureCjkFont.
 */
export function drawWalkSheetsInto(doc: jsPDF, font: string): void {
  const s = exportableState();
  const t = messages();
  const ordered = byOrder(s.formations);
  // Without the CJK font, drop text helvetica cannot render (draws garbage).
  const pdfSafe = (text: string): string =>
    font !== 'helvetica' || !Array.from(text).some((c) => (c.codePointAt(0) ?? 0) > 0xff)
      ? text
      : '';

  s.performers.forEach((performer, pageIndex) => {
    if (pageIndex > 0) doc.addPage('a4', 'landscape');

    const stops = ordered.flatMap((f) => {
      const pos = s.positions[f.id]?.[performer.id];
      return pos !== undefined ? [{ formation: f, pos }] : [];
    });

    // Header: mark dot + name + role, performance title on the right.
    doc.setFillColor(performer.color);
    doc.circle(MARGIN + 3, MARGIN + 1, 3, 'F');
    const badge = pdfSafe(performer.badge ?? '');
    if (badge !== '') {
      doc.setFontSize(badge.length <= 1 ? 8 : 5);
      doc.setTextColor('#ffffff');
      doc.setFont(font, 'bold');
      doc.text(badge, MARGIN + 3, MARGIN + 2.2, { align: 'center' });
    }
    doc.setTextColor(INK);
    doc.setFont(font, 'bold');
    doc.setFontSize(15);
    doc.text(pdfSafe(performer.name) || `#${pageIndex + 1}`, MARGIN + 9, MARGIN + 3);
    doc.setFont(font, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(DIM);
    if (performer.role !== '') doc.text(pdfSafe(performer.role), MARGIN + 9, MARGIN + 8);
    doc.text(pdfSafe(s.performance.title), PAGE_W - MARGIN, MARGIN + 3, { align: 'right' });

    // Stage plot, left side. Wings extend the fitted extent so offstage
    // stops still land inside the plot (origin shifts under flip).
    const flip = s.performance.audienceAt === 'top';
    const wings = s.performance.wings ?? { left: 0, right: 0, back: 0 };
    const totalW = s.performance.stageWidth + wings.left + wings.right;
    const totalH = s.performance.stageHeight + wings.back;
    const plotW = 168;
    const plotH = PAGE_H - MARGIN * 2 - HEADER_H;
    const scale = Math.min(plotW / totalW, plotH / totalH);
    const stageW = s.performance.stageWidth * scale;
    const stageH = s.performance.stageHeight * scale;
    const originX = MARGIN + (flip ? wings.right : wings.left) * scale;
    const originY =
      MARGIN + HEADER_H + (plotH - totalH * scale) / 2 + (flip ? 0 : wings.back) * scale;

    doc.setDrawColor(INK);
    doc.setLineWidth(0.4);
    doc.rect(originX, originY, stageW, stageH);

    // 1-meter grid — same reference lines the editor canvas shows.
    doc.setLineWidth(0.1);
    doc.setDrawColor('#d8d2c8');
    for (let m = 1; m < s.performance.stageWidth; m++) {
      doc.line(originX + m * scale, originY, originX + m * scale, originY + stageH);
    }
    for (let m = 1; m < s.performance.stageHeight; m++) {
      doc.line(originX, originY + m * scale, originX + stageW, originY + m * scale);
    }

    doc.setLineWidth(0.15);
    doc.setDrawColor(DIM);
    doc.setLineDashPattern([1.5, 1.5], 0);
    doc.line(originX + stageW / 2, originY, originX + stageW / 2, originY + stageH);
    doc.setLineDashPattern([], 0);

    const toPt = (pos: { x: number; y: number }): { x: number; y: number } => ({
      x: originX + (flip ? s.performance.stageWidth - pos.x : pos.x) * scale,
      y: originY + (flip ? s.performance.stageHeight - pos.y : pos.y) * scale,
    });
    doc.setFontSize(7);
    doc.setTextColor(DIM);
    doc.text(t.stage.audience, originX + stageW / 2, flip ? originY - 2.5 : originY + stageH + 5, {
      align: 'center',
    });

    // Route: dashed legs between consecutive stops, numbered circles on top.
    // Curve transitions draw their actual quadratic Bézier (converted to the
    // cubic form jsPDF's `lines` takes: each cubic control = 2/3 toward the
    // quadratic control point).
    doc.setDrawColor(performer.color);
    doc.setLineWidth(0.4);
    doc.setLineDashPattern([2, 1.6], 0);
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i];
      const b = stops[i + 1];
      if (a === undefined || b === undefined) continue;
      const aPt = toPt(a.pos);
      const bPt = toPt(b.pos);
      const control =
        a.formation.transitionType === 'curve' ? a.pos.curveControlPoints?.[0] : undefined;
      if (control !== undefined) {
        const cPt = toPt(control);
        const c1 = { x: aPt.x + (2 / 3) * (cPt.x - aPt.x), y: aPt.y + (2 / 3) * (cPt.y - aPt.y) };
        const c2 = { x: bPt.x + (2 / 3) * (cPt.x - bPt.x), y: bPt.y + (2 / 3) * (cPt.y - bPt.y) };
        doc.lines(
          [[c1.x - aPt.x, c1.y - aPt.y, c2.x - aPt.x, c2.y - aPt.y, bPt.x - aPt.x, bPt.y - aPt.y]],
          aPt.x,
          aPt.y,
        );
      } else {
        doc.line(aPt.x, aPt.y, bPt.x, bPt.y);
      }
    }
    doc.setLineDashPattern([], 0);
    stops.forEach((stop, i) => {
      const { x, y } = toPt(stop.pos);
      doc.setFillColor('#ffffff');
      doc.setDrawColor(performer.color);
      doc.setLineWidth(0.5);
      doc.circle(x, y, 3, 'FD');
      doc.setFontSize(7.5);
      doc.setTextColor(INK);
      doc.setFont(font, 'bold');
      doc.text(String(i + 1), x, y + 1, { align: 'center' });
    });

    // Table, right side: # / formation / time / counts / position / facing.
    // Counts anchor the cue musically ("enter on 8ct 3, count 1") when a
    // BPM is set — the same numbering the timeline ruler shows.
    const tableX = MARGIN + plotW + 10;
    const tableW = PAGE_W - MARGIN - tableX;
    const rowY = MARGIN + HEADER_H + 4;
    doc.setFont(font, 'bold');
    doc.setFontSize(8);
    doc.setTextColor(INK);
    doc.text('#', tableX, rowY);
    doc.text(t.print.colFormation, tableX + 7, rowY);
    doc.text(t.print.colTime, tableX + 34, rowY);
    doc.text('8ct', tableX + 60, rowY);
    doc.text('x,y (m)', tableX + 71, rowY);
    doc.text(t.print.colFace, tableX + 85, rowY);
    doc.setLineWidth(0.2);
    doc.setDrawColor(DIM);
    doc.line(tableX, rowY + 1.5, tableX + tableW, rowY + 1.5);
    doc.setFont(font, 'normal');

    const rowH = 5.4;
    const maxRows = Math.floor((PAGE_H - MARGIN - rowY - 6) / rowH);
    stops.slice(0, maxRows).forEach((stop, i) => {
      const y = rowY + 5 + i * rowH;
      const holdEnd = stop.formation.startTimeMs + stop.formation.durationMs;
      doc.setFontSize(8);
      doc.setTextColor(INK);
      doc.text(String(i + 1), tableX, y);
      doc.text(pdfSafe(stop.formation.name).slice(0, 13) || `(${i + 1})`, tableX + 7, y);
      doc.setTextColor(DIM);
      doc.text(
        `${formatTimecode(stop.formation.startTimeMs)}-${formatTimecode(holdEnd)}`,
        tableX + 34,
        y,
      );
      const counts =
        s.performance.bpm !== null
          ? (formatEightCount(
              stop.formation.startTimeMs,
              s.performance.bpm,
              s.performance.countSegments,
            )?.replace('8ct ', '') ?? '—')
          : '—';
      doc.text(counts, tableX + 60, y);
      doc.setTextColor(INK);
      doc.text(`${stop.pos.x.toFixed(1)}, ${stop.pos.y.toFixed(1)}`, tableX + 71, y);
      doc.text(`${Math.round(stop.pos.rotation)}°`, tableX + 85, y);
    });
    if (stops.length > maxRows) {
      doc.setFontSize(7.5);
      doc.setTextColor(DIM);
      doc.text(t.print.moreRows(stops.length - maxRows), tableX, rowY + 5 + maxRows * rowH);
    }

    doc.setFontSize(7.5);
    doc.setTextColor(DIM);
    doc.text(t.print.page(pageIndex + 1), PAGE_W - MARGIN, PAGE_H - 7, { align: 'right' });
  });
}
