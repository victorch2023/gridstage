import { jsPDF } from 'jspdf';
import { exportableState } from '../state/store';
import { byOrder, formatTimecode } from '../state/interpolate';
import { placeOutline, propOutline } from '../state/props';
import { safeFilename } from './filename';
import { ensureCjkFont, hasCjk } from './pdfFont';
import { messages } from '../i18n';

// A4 landscape, millimeters.
const PAGE_W = 297;
const PAGE_H = 210;
const MARGIN = 18;
const HEADER_H = 16;

const INK = '#26221e';
const DIM = '#8a8074';

/**
 * Walk chart: one page per formation (stage plan with marks, facing arrows
 * and names) plus a roster page. Drawn as vectors — crisp at any print size.
 * When any text is CJK the bundled Noto Sans TC subset is embedded.
 */
export async function exportPerformancePdf(): Promise<void> {
  const s = exportableState();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const font = await ensureCjkFont(doc, hasCjk(chartText()));
  drawWalkChartsInto(doc, font);
  doc.save(`${safeFilename(s.performance.title)}-walk-charts.pdf`);
}

/** Every string the charts print — the pack checks it for CJK too. */
export function chartText(): string {
  const s = exportableState();
  return [
    s.performance.title,
    ...s.performers.flatMap((p) => [p.name, p.role]),
    ...s.props.map((p) => p.name),
    ...s.formations.map((f) => f.name),
    ...s.annotations.map((a) => a.text ?? ''),
  ].join('');
}

/**
 * Draw the roster page + one chart per formation starting on the CURRENT
 * page. The font must already be registered via ensureCjkFont.
 */
export function drawWalkChartsInto(doc: jsPDF, font: string): void {
  const s = exportableState();
  const t = messages();
  const ordered = byOrder(s.formations);

  drawRosterPage(doc, s.performance.title, font);

  ordered.forEach((formation, index) => {
    doc.addPage('a4', 'landscape');
    const positions = s.positions[formation.id] ?? {};

    // Header
    doc.setTextColor(INK);
    doc.setFont(font, 'bold');
    doc.setFontSize(14);
    doc.text(`${index + 1}. ${formation.name}`, MARGIN, MARGIN);
    doc.setFont(font, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(DIM);
    const holdEnd = formation.startTimeMs + formation.durationMs;
    doc.text(
      `${formatTimecode(formation.startTimeMs)} – ${formatTimecode(holdEnd)}   ·   ${t.print.transitionOut(formation.transitionType === 'curve' ? t.print.transitionCurve : t.print.transitionLinear)}`,
      MARGIN,
      MARGIN + 5,
    );
    doc.text(s.performance.title, PAGE_W - MARGIN, MARGIN, { align: 'right' });

    // Stage box, meters -> mm. Wings extend the fitted extent; the floor
    // origin shifts by whichever wing lands page-left/top (swap under flip).
    const flip = s.performance.audienceAt === 'top';
    const wings = s.performance.wings ?? { left: 0, right: 0, back: 0 };
    const totalW = s.performance.stageWidth + wings.left + wings.right;
    const totalH = s.performance.stageHeight + wings.back;
    const availW = PAGE_W - MARGIN * 2;
    const availH = PAGE_H - MARGIN * 2 - HEADER_H - 8;
    const scale = Math.min(availW / totalW, availH / totalH);
    const stageW = s.performance.stageWidth * scale;
    const stageH = s.performance.stageHeight * scale;
    const originX = (PAGE_W - totalW * scale) / 2 + (flip ? wings.right : wings.left) * scale;
    const originY =
      MARGIN + HEADER_H + (availH - totalH * scale) / 2 + (flip ? 0 : wings.back) * scale;

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

    // Center line
    doc.setLineWidth(0.15);
    doc.setDrawColor(DIM);
    doc.setLineDashPattern([1.5, 1.5], 0);
    doc.line(originX + stageW / 2, originY, originX + stageW / 2, originY + stageH);
    doc.setLineDashPattern([], 0);

    doc.setFontSize(8);
    doc.setTextColor(DIM);
    doc.text(t.stage.audience, PAGE_W / 2, flip ? originY - 3 : originY + stageH + 6, {
      align: 'center',
    });

    const toPage = (xM: number, yM: number): [number, number] => [
      originX + (flip ? s.performance.stageWidth - xM : xM) * scale,
      originY + (flip ? s.performance.stageHeight - yM : yM) * scale,
    ];

    // Wings/backstage: dashed holding zones hugging the floor.
    doc.setDrawColor(DIM);
    doc.setLineWidth(0.2);
    doc.setLineDashPattern([1.2, 1.2], 0);
    for (const zone of [
      { w: wings.left, x0: -wings.left, y0: -wings.back, x1: 0, y1: s.performance.stageHeight },
      {
        w: wings.right,
        x0: s.performance.stageWidth,
        y0: -wings.back,
        x1: s.performance.stageWidth + wings.right,
        y1: s.performance.stageHeight,
      },
      { w: wings.back, x0: 0, y0: -wings.back, x1: s.performance.stageWidth, y1: 0 },
    ]) {
      if (zone.w <= 0) continue;
      const [ax, ay] = toPage(zone.x0, zone.y0);
      const [bx, by] = toPage(zone.x1, zone.y1);
      doc.rect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
    }
    doc.setLineDashPattern([], 0);

    for (const piece of s.fixtures ?? []) {
      const [cx, cy] = toPage(piece.x, piece.y);
      const w = piece.width * scale;
      const h = piece.height * scale;
      doc.setDrawColor(piece.color);
      doc.setFillColor(piece.color);
      doc.setLineWidth(0.4);
      doc.rect(cx - w / 2, cy - h / 2, w, h, 'S');
      doc.setFontSize(7);
      doc.setTextColor(DIM);
      doc.text(piece.label, cx, cy + 1, { align: 'center' });
    }
    for (const piece of s.captions ?? []) {
      const [cx, cy] = toPage(piece.x, piece.y);
      doc.setFontSize(9);
      doc.setTextColor(piece.color);
      doc.text(piece.text, cx, cy, { align: 'center' });
    }

    // Props: scenery outlines under the marks.
    for (const prop of s.props) {
      const pos = positions[prop.id];
      if (pos === undefined) continue;
      doc.setDrawColor(prop.color);
      doc.setLineWidth(0.5);
      if (prop.kind === 'circle') {
        // ponytail: ellipse ignores rotation — fine for the common circle case.
        const [cx, cy] = toPage(pos.x, pos.y);
        doc.ellipse(cx, cy, (prop.width / 2) * scale, (prop.height / 2) * scale, 'S');
      } else {
        const corners = placeOutline(
          propOutline(prop.kind, prop.width, prop.height),
          pos.x,
          pos.y,
          pos.rotation,
        ).map(([xM, yM]) => toPage(xM, yM));
        const first = corners[0];
        if (first === undefined) continue;
        const segments = corners.slice(1).map((corner, i) => {
          const prev = corners[i] as [number, number];
          return [corner[0] - prev[0], corner[1] - prev[1]];
        });
        doc.lines(segments, first[0], first[1], [1, 1], 'S', true);
      }
      const [labelX, labelY] = toPage(pos.x, pos.y);
      doc.setFontSize(7);
      doc.setTextColor(DIM);
      doc.text(prop.name, labelX, labelY + 1, { align: 'center' });
    }

    // Rehearsal annotations (pen strokes + text pins), under the marks.
    for (const note of s.annotations.filter((a) => a.formationId === formation.id)) {
      if (note.kind === 'stroke' && note.points !== undefined && note.points.length >= 4) {
        doc.setDrawColor(note.color);
        doc.setLineWidth(0.5);
        const pts: [number, number][] = [];
        for (let i = 0; i + 1 < note.points.length; i += 2) {
          pts.push(toPage(note.points[i] ?? 0, note.points[i + 1] ?? 0));
        }
        const first = pts[0] as [number, number];
        const segments = pts.slice(1).map((pt, i) => {
          const prev = pts[i] as [number, number];
          return [pt[0] - prev[0], pt[1] - prev[1]];
        });
        doc.lines(segments, first[0], first[1], [1, 1], 'S', false);
      } else if (note.kind === 'pin' && note.x !== undefined && note.y !== undefined) {
        const [px, py] = toPage(note.x, note.y);
        doc.setFillColor(note.color);
        doc.circle(px, py, 1.1, 'F');
        if (note.text !== undefined && note.text !== '') {
          doc.setFontSize(7);
          doc.setTextColor(INK);
          doc.text(note.text, px + 2.2, py + 0.8);
        }
      }
    }

    // Marks
    for (const performer of s.performers) {
      const pos = positions[performer.id];
      if (pos === undefined) continue;
      const x = originX + (flip ? s.performance.stageWidth - pos.x : pos.x) * scale;
      const y = originY + (flip ? s.performance.stageHeight - pos.y : pos.y) * scale;
      const arm = 1.8;

      doc.setDrawColor(performer.color);
      doc.setLineWidth(0.7);
      doc.line(x - arm, y - arm, x + arm, y + arm);
      doc.line(x - arm, y + arm, x + arm, y - arm);

      // Facing arrow: rotation 0 = toward audience (page-down; page-up when
      // flipped), clockwise.
      const angleRad = ((pos.rotation + (flip ? 270 : 90)) * Math.PI) / 180;
      const dirX = Math.cos(angleRad);
      const dirY = Math.sin(angleRad);
      const tipX = x + dirX * 6;
      const tipY = y + dirY * 6;
      doc.setLineWidth(0.35);
      doc.line(x + dirX * 2.4, y + dirY * 2.4, tipX, tipY);
      const headAngle = Math.PI / 7;
      const headLen = 1.6;
      doc.line(
        tipX,
        tipY,
        tipX - headLen * Math.cos(angleRad - headAngle),
        tipY - headLen * Math.sin(angleRad - headAngle),
      );
      doc.line(
        tipX,
        tipY,
        tipX - headLen * Math.cos(angleRad + headAngle),
        tipY - headLen * Math.sin(angleRad + headAngle),
      );

      doc.setFontSize(8);
      doc.setTextColor(INK);
      doc.text(performer.name, x, y + arm + 3.5, { align: 'center' });
    }

    doc.setFontSize(8);
    doc.setTextColor(DIM);
    doc.text(t.print.page(index + 2), PAGE_W - MARGIN, PAGE_H - 8, { align: 'right' });
  });
}

function drawRosterPage(doc: jsPDF, title: string, font: string): void {
  const s = exportableState();
  const t = messages();

  doc.setFont(font, 'bold');
  doc.setFontSize(20);
  doc.setTextColor(INK);
  doc.text(title, MARGIN, MARGIN + 6);
  doc.setFont(font, 'normal');
  doc.setFontSize(10);
  doc.setTextColor(DIM);
  doc.text(
    t.print.summary(
      s.performers.length,
      s.formations.length,
      s.performance.stageWidth,
      s.performance.stageHeight,
    ),
    MARGIN,
    MARGIN + 13,
  );

  doc.setFontSize(11);
  doc.setTextColor(INK);
  doc.text(t.print.roster, MARGIN, MARGIN + 26);
  doc.setLineWidth(0.2);
  doc.setDrawColor(DIM);
  doc.line(MARGIN, MARGIN + 28, PAGE_W - MARGIN, MARGIN + 28);

  const rowH = 7;
  const colW = (PAGE_W - MARGIN * 2) / 2;
  const rowsPerCol = Math.floor((PAGE_H - (MARGIN + 34) - MARGIN) / rowH);

  s.performers.forEach((p, i) => {
    const col = Math.floor(i / rowsPerCol);
    const row = i % rowsPerCol;
    const x = MARGIN + col * colW;
    const y = MARGIN + 34 + row * rowH;
    doc.setFillColor(p.color);
    doc.circle(x + 2, y - 1.2, 1.6, 'F');
    doc.setFontSize(10);
    doc.setTextColor(INK);
    doc.text(p.name, x + 7, y);
    if (p.role !== '') {
      doc.setTextColor(DIM);
      doc.text(p.role, x + 7 + doc.getTextWidth(p.name) + 4, y);
    }
  });

  doc.setFontSize(8);
  doc.setTextColor(DIM);
  doc.text(t.print.page(1), PAGE_W - MARGIN, PAGE_H - 8, { align: 'right' });
}
