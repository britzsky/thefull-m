// 엑셀 서식 미리보기 WebView 실행 코드 (웹 ERP utils/ExcelStyledSheet.js와 같은 방식)
// ExcelJS로 병합·열 너비·행 높이·글꼴·채우기·테두리·정렬과 시트 안 그림을 살려 표로 그림
// .xls처럼 ExcelJS가 못 읽는 파일은 SheetJS로 값과 병합만 그림
export const EXCEL_PREVIEW_SCRIPT = String.raw`
(function () {
  // 화면에 그릴 최대 행·열 (큰 파일 렌더 부하 방지)
  var MAX_ROWS = 300;
  var MAX_COLS = 60;
  // 엑셀 기본 열 너비(문자 수)·행 높이(pt)
  var DEFAULT_COL_WIDTH = 8.43;
  var DEFAULT_ROW_HEIGHT = 15;
  // 셀 테두리가 없을 때 보여주는 눈금선
  var GRID_LINE = '1px solid #e3e3e3';
  // 그림 위치 오프셋 단위 변환 (EMU → px)
  var EMU_PER_PX = 9525;
  // 오피스 기본 테마 색 (순서: lt1 dk1 lt2 dk2 accent1~6 hlink folHlink)
  var DEFAULT_THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '0563C1', '954F72'];
  // 엑셀 기본 색인 색 (indexed 0~63)
  var INDEXED_COLORS = [
    '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
    '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
    '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
    '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
    '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
    '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
    '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
    '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333'
  ];
  // 테두리 종류별 CSS (굵기·선 모양)
  var BORDER_STYLE = {
    thin: '1px solid', hair: '1px solid', dotted: '1px dotted', dashed: '1px dashed',
    dashDot: '1px dashed', dashDotDot: '1px dashed', medium: '2px solid', mediumDashed: '2px dashed',
    mediumDashDot: '2px dashed', mediumDashDotDot: '2px dashed', slantDashDot: '2px dashed',
    thick: '3px solid', double: '3px double'
  };

  // 통합문서 테마 XML에서 테마 색 목록 추출 (실패 시 기본 테마)
  function readThemeColors(workbook) {
    try {
      var xml = workbook && workbook._themes && workbook._themes.theme1;
      if (!xml) return DEFAULT_THEME;
      var doc = new DOMParser().parseFromString(xml, 'text/xml');
      var scheme = doc.getElementsByTagName('a:clrScheme')[0];
      if (!scheme) return DEFAULT_THEME;
      var pick = function (tag) {
        var node = scheme.getElementsByTagName('a:' + tag)[0];
        if (!node) return null;
        var srgb = node.getElementsByTagName('a:srgbClr')[0];
        var sys = node.getElementsByTagName('a:sysClr')[0];
        return (srgb && srgb.getAttribute('val')) || (sys && sys.getAttribute('lastClr')) || null;
      };
      return ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'].map(function (tag, i) {
        return pick(tag) || DEFAULT_THEME[i];
      });
    } catch (error) {
      return DEFAULT_THEME;
    }
  }

  // 테마 색 밝기 보정 (tint: -1 어둡게 ~ 1 밝게)
  function applyTint(hex, tint) {
    if (!tint) return hex;
    return [0, 2, 4].map(function (i) {
      var c = parseInt(hex.slice(i, i + 2), 16);
      var next = Math.round(tint < 0 ? c * (1 + tint) : c + (255 - c) * tint);
      return Math.min(255, Math.max(0, next)).toString(16).padStart(2, '0');
    }).join('');
  }

  // ExcelJS 색 객체를 CSS 색으로 변환 (argb / theme+tint / indexed)
  function toCssColor(color, theme) {
    if (!color) return null;
    if (color.argb) return '#' + String(color.argb).slice(-6);
    if (color.theme !== undefined) return '#' + applyTint(theme[color.theme] || '000000', color.tint);
    if (color.indexed !== undefined) {
      var hex = INDEXED_COLORS[color.indexed];
      return hex ? '#' + hex : null;
    }
    return null;
  }

  // 테두리 한 변을 CSS로 변환 (없으면 null)
  function toCssBorder(side, theme) {
    return side && side.style ? (BORDER_STYLE[side.style] || '1px solid') + ' ' + (toCssColor(side.color, theme) || '#000') : null;
  }

  // 셀 표시 글자 (날짜는 YYYY-MM-DD, 천 단위 서식 숫자는 콤마, 그 외 ExcelJS 표시값)
  function cellText(cell) {
    var value = cell.value;
    if (value === null || value === undefined) return '';
    var raw = value.result !== undefined ? value.result : value;
    if (raw instanceof Date) {
      return raw.getUTCFullYear() + '-' + String(raw.getUTCMonth() + 1).padStart(2, '0') + '-' + String(raw.getUTCDate()).padStart(2, '0');
    }
    if (typeof raw === 'number' && /#,##0/.test(cell.numFmt || '')) {
      var decimals = (String(cell.numFmt).split('.')[1] || '').replace(/[^0#]/g, '').length;
      return raw.toLocaleString('ko-KR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    }
    if (typeof raw === 'number' && /%/.test(cell.numFmt || '')) return Math.round(raw * 1000) / 10 + '%';
    try {
      return cell.text !== undefined && cell.text !== null ? cell.text : String(raw);
    } catch (error) {
      return String(raw);
    }
  }

  // ExcelJS 워크시트를 그리기용 모델로 변환 (열 너비, 행, 셀 스타일, 병합 범위, 그림 위치)
  function buildStyledSheet(ws, theme, imageUrlOf) {
    var rowCount = Math.min(ws.rowCount || 0, MAX_ROWS);
    var colCount = Math.min(ws.columnCount || 0, MAX_COLS);
    var showGrid = !(ws.views && ws.views[0] && ws.views[0].showGridLines === false);

    // 병합 범위: 왼쪽 위 셀 → { rowSpan, colSpan, r2, c2 }, 가려지는 셀 목록
    var mergeStart = {};
    var covered = {};
    ((ws.model && ws.model.merges) || []).forEach(function (range) {
      var ends = range.split(':');
      var tl = ws.getCell(ends[0]);
      var br = ws.getCell(ends[1]);
      var r1 = Number(tl.row), c1 = Number(tl.col), r2 = Number(br.row), c2 = Number(br.col);
      mergeStart[r1 + ':' + c1] = { rowSpan: r2 - r1 + 1, colSpan: c2 - c1 + 1, r2: r2, c2: c2 };
      for (var r = r1; r <= r2; r += 1) {
        for (var c = c1; c <= c2; c += 1) if (r !== r1 || c !== c1) covered[r + ':' + c] = true;
      }
    });

    var hiddenCols = {};
    var cols = [];
    for (var c = 1; c <= colCount; c += 1) {
      var col = ws.getColumn(c);
      if (col.hidden) hiddenCols[c] = true;
      else cols.push({ c: c, width: Math.round((col.width || DEFAULT_COL_WIDTH) * 7 + 5) });
    }

    // 셀 한 변의 테두리 (자기 테두리 → 맞닿은 셀의 반대쪽 테두리 → 눈금선 순)
    var edge = function (r, c, side, nr, nc, opposite) {
      var own = ws.getCell(r, c).border;
      var near = nr > 0 && nc > 0 ? ws.getCell(nr, nc).border : null;
      return toCssBorder(own && own[side], theme) || toCssBorder(near && near[opposite], theme) || (showGrid ? GRID_LINE : 'none');
    };

    var rows = [];
    for (var r = 1; r <= rowCount; r += 1) {
      var row = ws.getRow(r);
      if (!row.hidden) {
        var cells = [];
        cols.forEach(function (colInfo) {
          var c = colInfo.c;
          var key = r + ':' + c;
          if (covered[key]) return;
          var merge = mergeStart[key];
          var cell = ws.getCell(r, c);
          var style = cell.style || {};
          var font = style.font || {};
          var fill = style.fill;
          var alignment = style.alignment || {};
          var cellValue = cell.value && cell.value.result !== undefined ? cell.value.result : cell.value;
          var isNumber = typeof cellValue === 'number';
          // 병합 셀은 오른쪽·아래 테두리를 병합 끝 셀에서 가져옴
          var rEnd = merge ? merge.r2 : r;
          var cEnd = merge ? merge.c2 : c;
          // 병합 안에서 숨김 열은 colSpan에서 제외
          var colSpan = merge ? merge.colSpan : 1;
          if (merge) for (var cc = c; cc <= cEnd; cc += 1) if (hiddenCols[cc]) colSpan -= 1;
          var fillColor = fill && fill.type === 'pattern' && fill.pattern !== 'none' ? toCssColor(fill.fgColor, theme) : null;
          cells.push({
            text: cellText(cell),
            rowSpan: merge ? merge.rowSpan : 1,
            colSpan: Math.max(colSpan, 1),
            style: {
              backgroundColor: fillColor || '#ffffff',
              color: toCssColor(font.color, theme) || '#000000',
              fontWeight: font.bold ? 700 : 400,
              fontStyle: font.italic ? 'italic' : 'normal',
              textDecoration: [font.underline ? 'underline' : '', font.strike ? 'line-through' : ''].join(' ').trim() || 'none',
              fontSize: ((font.size || 11) * 4) / 3 + 'px',
              fontFamily: font.name ? '"' + font.name + '", "맑은 고딕", sans-serif' : '"맑은 고딕", sans-serif',
              textAlign: { left: 'left', center: 'center', centerContinuous: 'center', right: 'right', justify: 'justify', distributed: 'justify' }[alignment.horizontal] || (isNumber ? 'right' : 'left'),
              verticalAlign: { top: 'top', middle: 'middle', center: 'middle', bottom: 'bottom' }[alignment.vertical] || 'bottom',
              whiteSpace: alignment.wrapText ? 'pre-wrap' : 'pre',
              wordBreak: alignment.wrapText ? 'break-all' : 'normal',
              paddingLeft: (alignment.indent ? alignment.indent * 9 + 2 : 2) + 'px',
              borderTop: edge(r, c, 'top', r - 1, c, 'bottom'),
              borderLeft: edge(r, c, 'left', r, c - 1, 'right'),
              borderBottom: edge(rEnd, c, 'bottom', rEnd + 1, c, 'top'),
              borderRight: edge(r, cEnd, 'right', r, cEnd + 1, 'left')
            }
          });
        });
        rows.push({ r: r, height: Math.round(((row.height || DEFAULT_ROW_HEIGHT) * 4) / 3), cells: cells });
      }
    }

    // 그림 배치: 열·행 시작 위치(px)를 누적해 그림 기준 셀 + 셀 안 오프셋으로 좌표 계산 (숨김 행·열은 0 크기)
    var colWidth = {};
    cols.forEach(function (item) { colWidth[item.c] = item.width; });
    var rowHeight = {};
    rows.forEach(function (item) { rowHeight[item.r] = item.height; });
    var colStart = [0, 0];
    for (var ci = 1; ci <= colCount; ci += 1) colStart[ci + 1] = colStart[ci] + (colWidth[ci] || 0);
    var rowStart = [0, 0];
    for (var ri = 1; ri <= rowCount; ri += 1) rowStart[ri + 1] = rowStart[ri] + (rowHeight[ri] || 0);
    var xOf = function (nativeCol, off) { return colStart[Math.min(nativeCol + 1, colCount + 1)] + (off || 0) / EMU_PER_PX; };
    var yOf = function (nativeRow, off) { return rowStart[Math.min(nativeRow + 1, rowCount + 1)] + (off || 0) / EMU_PER_PX; };
    var images = [];
    (ws.getImages ? ws.getImages() : []).forEach(function (img) {
      var range = img.range || {};
      var tl = range.tl, br = range.br, ext = range.ext;
      var url = imageUrlOf(img.imageId);
      if (!tl || !url) return;
      var left = xOf(tl.nativeCol, tl.nativeColOff);
      var top = yOf(tl.nativeRow, tl.nativeRowOff);
      var width = br ? xOf(br.nativeCol, br.nativeColOff) - left : (ext && ext.width) || 0;
      var height = br ? yOf(br.nativeRow, br.nativeRowOff) - top : (ext && ext.height) || 0;
      if (width > 0 && height > 0 && top < rowStart[rowCount + 1]) images.push({ url: url, left: left, top: top, width: width, height: height });
    });

    return { cols: cols, rows: rows, images: images, truncated: (ws.rowCount || 0) > MAX_ROWS || (ws.columnCount || 0) > MAX_COLS };
  }

  // SheetJS 워크시트를 그리기용 모델로 변환 (.xls 대체 경로: 값·병합·열 너비만)
  function buildPlainSheet(ws) {
    var ref = ws['!ref'];
    if (!ref) return { cols: [], rows: [], images: [], truncated: false };
    var range = XLSX.utils.decode_range(ref);
    var rowCount = Math.min(range.e.r + 1, MAX_ROWS);
    var colCount = Math.min(range.e.c + 1, MAX_COLS);
    var mergeStart = {};
    var covered = {};
    (ws['!merges'] || []).forEach(function (merge) {
      var s = merge.s, e = merge.e;
      mergeStart[s.r + ':' + s.c] = { rowSpan: e.r - s.r + 1, colSpan: e.c - s.c + 1 };
      for (var r = s.r; r <= e.r; r += 1) for (var c = s.c; c <= e.c; c += 1) if (r !== s.r || c !== s.c) covered[r + ':' + c] = true;
    });
    var cols = [];
    for (var c = 0; c < colCount; c += 1) {
      var info = ws['!cols'] && ws['!cols'][c];
      cols.push({ c: c, width: Math.round(((info && info.wch) || DEFAULT_COL_WIDTH) * 7 + 5) });
    }
    var rows = [];
    for (var r = 0; r < rowCount; r += 1) {
      var cells = [];
      for (var cc = 0; cc < colCount; cc += 1) {
        var key = r + ':' + cc;
        if (!covered[key]) {
          var cell = ws[XLSX.utils.encode_cell({ r: r, c: cc })];
          var text = cell ? (cell.w !== undefined ? cell.w : cell.v) : '';
          cells.push({
            text: text === undefined || text === null ? '' : String(text),
            rowSpan: mergeStart[key] ? mergeStart[key].rowSpan : 1,
            colSpan: mergeStart[key] ? mergeStart[key].colSpan : 1,
            style: { border: GRID_LINE, fontSize: '14px', whiteSpace: 'pre', verticalAlign: 'bottom', textAlign: cell && cell.t === 'n' ? 'right' : 'left', paddingLeft: '2px' }
          });
        }
      }
      rows.push({ r: r, height: Math.round(DEFAULT_ROW_HEIGHT * (4 / 3)), cells: cells });
    }
    return { cols: cols, rows: rows, images: [], truncated: range.e.r + 1 > MAX_ROWS || range.e.c + 1 > MAX_COLS };
  }

  // 엑셀 안 그림 바이트를 화면용 data URL로 변환
  function toImageUrl(media) {
    if (!media || !media.buffer) return null;
    var bytes = new Uint8Array(media.buffer);
    var binary = '';
    for (var i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    return 'data:image/' + (media.extension || 'png') + ';base64,' + btoa(binary);
  }

  // 파일을 읽어 시트별 그리기 모델 목록으로 변환 (xlsx: 서식·그림 포함, 실패 시 값만)
  async function loadSheets(bytes) {
    try {
      var workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes.buffer);
      var theme = readThemeColors(workbook);
      var imageUrls = {};
      var imageUrlOf = function (id) {
        if (imageUrls[id] === undefined) imageUrls[id] = toImageUrl(workbook.getImage(id));
        return imageUrls[id];
      };
      var sheets = workbook.worksheets
        .filter(function (ws) { return ws.state !== 'hidden' && ws.state !== 'veryHidden'; })
        .map(function (ws) { return Object.assign({ name: ws.name, styled: true }, buildStyledSheet(ws, theme, imageUrlOf)); });
      if (sheets.length) return sheets;
    } catch (error) {
      // ExcelJS가 못 읽는 형식(.xls 등)은 아래 SheetJS 경로로 처리
    }
    var book = XLSX.read(bytes, { type: 'array' });
    return book.SheetNames.map(function (name) {
      return Object.assign({ name: name, styled: false }, buildPlainSheet(book.Sheets[name]));
    });
  }

  // 선택한 시트를 서식 표와 그림으로 그림
  function drawSheet(sheet, zoom) {
    var view = document.getElementById('view');
    view.innerHTML = '';
    var page = document.createElement('div');
    page.style.zoom = zoom;
    page.style.padding = '8px';
    var tableWidth = sheet.cols.reduce(function (sum, col) { return sum + col.width; }, 0);
    // 표와 그림 겹침 영역 (그림은 셀 기준 좌표로 표 위에 배치)
    var box = document.createElement('div');
    box.style.position = 'relative';
    box.style.width = tableWidth + 'px';
    var table = document.createElement('table');
    table.style.cssText = 'border-collapse:collapse;table-layout:fixed;width:' + tableWidth + 'px';
    var group = document.createElement('colgroup');
    sheet.cols.forEach(function (col) {
      var item = document.createElement('col');
      item.style.width = col.width + 'px';
      group.appendChild(item);
    });
    table.appendChild(group);
    var body = document.createElement('tbody');
    sheet.rows.forEach(function (row) {
      var tr = document.createElement('tr');
      tr.style.height = row.height + 'px';
      row.cells.forEach(function (cell) {
        var td = document.createElement('td');
        td.rowSpan = cell.rowSpan;
        td.colSpan = cell.colSpan;
        td.textContent = cell.text;
        Object.assign(td.style, cell.style, { paddingTop: '0', paddingBottom: '0', paddingRight: '2px', overflow: 'hidden', lineHeight: '1.25' });
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    table.appendChild(body);
    box.appendChild(table);
    sheet.images.forEach(function (image) {
      var img = document.createElement('img');
      img.src = image.url;
      img.style.cssText = 'position:absolute;left:' + image.left + 'px;top:' + image.top + 'px;width:' + image.width + 'px;height:' + image.height + 'px;object-fit:fill;pointer-events:none';
      box.appendChild(img);
    });
    page.appendChild(box);
    // 표시 범위 안내 (행·열 제한, 서식 미지원 형식)
    if (sheet.truncated || !sheet.styled) {
      var note = document.createElement('div');
      note.style.cssText = 'margin-top:8px;font-size:11px;color:#6b7280';
      note.textContent = (sheet.truncated ? '미리보기는 ' + MAX_ROWS + '행 · ' + MAX_COLS + '열까지만 표시합니다. ' : '') + (sheet.styled ? '' : '이 형식(.xls)은 서식 없이 값만 표시합니다.');
      page.appendChild(note);
    }
    view.appendChild(page);
  }

  // 엑셀 미리보기 시작 (시트 탭·확대 축소 도구 줄 구성 후 첫 시트 표시)
  window.renderStyledExcel = async function (bytes) {
    var sheets = await loadSheets(bytes);
    if (!sheets.length) throw new Error('시트 정보를 찾을 수 없습니다.');
    var sheetIndex = 0;
    var zoom = 1;
    var tabs = document.getElementById('tabs');
    var label = document.getElementById('zoomLabel');
    document.body.className = 'excel';
    var refresh = function () {
      Array.prototype.forEach.call(tabs.children, function (tab, i) { tab.className = i === sheetIndex ? 'active' : ''; });
      label.textContent = Math.round(zoom * 100) + '%';
      drawSheet(sheets[sheetIndex], zoom);
    };
    sheets.forEach(function (sheet, i) {
      var tab = document.createElement('button');
      tab.textContent = sheet.name;
      tab.onclick = function () { sheetIndex = i; refresh(); };
      tabs.appendChild(tab);
    });
    document.getElementById('zoomOut').onclick = function () { zoom = Math.max(0.4, Math.round((zoom - 0.1) * 10) / 10); refresh(); };
    document.getElementById('zoomIn').onclick = function () { zoom = Math.min(2.5, Math.round((zoom + 0.1) * 10) / 10); refresh(); };
    refresh();
  };
})();
`
