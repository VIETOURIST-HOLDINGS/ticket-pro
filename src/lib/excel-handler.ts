/**
 * Universal Excel handler that uses ExcelJS when available, fallbacks to XLSX.js
 * This provides the best of both worlds - rich formatting when possible, compatibility always
 */

import * as XLSX from 'xlsx';
import { format } from 'date-fns';

// ExcelJS types (for when it's available)
interface ExcelJSWorkbook {
  xlsx: {
    load(buffer: Buffer): Promise<void>;
    writeBuffer(): Promise<Buffer>;
  };
  worksheets: ExcelJSWorksheet[];
  getWorksheet(name: string): ExcelJSWorksheet | undefined;
}

interface ExcelJSWorksheet {
  name: string;
  actualRowCount: number;
  actualColumnCount: number;
  getCell(row: number, col: number): ExcelJSCell;
  getColumn(col: number): ExcelJSColumn;
  columns: ExcelJSColumn[];
  model: { merges?: string[] };
}

interface ExcelJSCell {
  value: any;
  font?: any;
  fill?: any;
  border?: any;
  alignment?: any;
}

interface ExcelJSColumn {
  width?: number;
}

/**
 * Universal Excel processor that automatically chooses the best available library
 */
export class UniversalExcelHandler {
  private useExcelJS: boolean = false;
  private ExcelJS: any = null;
  private excelJSWorkbook: ExcelJSWorkbook | null = null;
  private xlsxWorkbook: XLSX.WorkBook | null = null;
  private originalBuffer: Uint8Array | null = null;

  constructor() {
    // Try to load ExcelJS if available
    try {
      this.ExcelJS = require('exceljs');
      this.useExcelJS = true;
      console.log('✅ ExcelJS loaded - using enhanced formatting support');
    } catch (error) {
      this.useExcelJS = false;
      console.log('📋 ExcelJS not available - using XLSX.js fallback');
    }
  }

  /**
   * Read Excel file and detect capabilities
   */
  async readFile(buffer: Uint8Array): Promise<{
    sheets: string[];
    hasFormatting: boolean;
    library: 'ExcelJS' | 'XLSX.js';
  }> {
    this.originalBuffer = buffer;

    if (this.useExcelJS) {
      return await this.readWithExcelJS(buffer);
    } else {
      return this.readWithXLSX(buffer);
    }
  }

  /**
   * Read with ExcelJS (preferred)
   */
  private async readWithExcelJS(buffer: Uint8Array): Promise<{
    sheets: string[];
    hasFormatting: boolean;
    library: 'ExcelJS';
  }> {
    this.excelJSWorkbook = new this.ExcelJS.Workbook();
    await this.excelJSWorkbook!.xlsx.load(Buffer.from(buffer));

    const sheets = this.excelJSWorkbook!.worksheets.map(ws => ws.name);
    const hasFormatting = this.detectFormattingExcelJS();

    return {
      sheets,
      hasFormatting,
      library: 'ExcelJS'
    };
  }

  /**
   * Read with XLSX.js (fallback)
   */
  private readWithXLSX(buffer: Uint8Array): {
    sheets: string[];
    hasFormatting: boolean;
    library: 'XLSX.js';
  } {
    this.xlsxWorkbook = XLSX.read(buffer, {
      type: "array",
      cellStyles: true,
      cellFormula: true,
      cellDates: true,
      cellNF: true,
      bookVBA: true,
    });

    const sheets = this.xlsxWorkbook.SheetNames;
    const hasFormatting = this.detectFormattingXLSX();

    return {
      sheets,
      hasFormatting,
      library: 'XLSX.js'
    };
  }

  /**
   * Process sheet data for app consumption
   */
  processSheetData(sheetName: string): {
    headers: string[];
    rows: Record<string, any>[];
  } {
    if (this.useExcelJS && this.excelJSWorkbook) {
      return this.processSheetDataExcelJS(sheetName);
    } else if (this.xlsxWorkbook) {
      return this.processSheetDataXLSX(sheetName);
    } else {
      throw new Error('No workbook loaded');
    }
  }

  /**
   * Export modified workbook with check-in data
   */
  async exportWithCheckIns(
    activeSheetName: string,
    rows: any[]
  ): Promise<Uint8Array> {
    if (this.useExcelJS && this.excelJSWorkbook) {
      return await this.exportWithExcelJS(activeSheetName, rows);
    } else if (this.xlsxWorkbook && this.originalBuffer) {
      return this.exportWithXLSX(activeSheetName, rows);
    } else {
      throw new Error('No workbook loaded');
    }
  }

  /**
   * Get detailed analysis of a sheet
   */
  analyzeSheet(sheetName: string): {
    rowCount: number;
    columnCount: number;
    hasFormatting: boolean;
    formattingDetails: any;
    library: string;
  } {
    if (this.useExcelJS && this.excelJSWorkbook) {
      return this.analyzeSheetExcelJS(sheetName);
    } else if (this.xlsxWorkbook) {
      return this.analyzeSheetXLSX(sheetName);
    } else {
      throw new Error('No workbook loaded');
    }
  }

  // ExcelJS implementations
  private detectFormattingExcelJS(): boolean {
    if (!this.excelJSWorkbook) return false;

    for (const worksheet of this.excelJSWorkbook.worksheets) {
      // Check column widths
      if (worksheet.columns.some(col => col.width)) {
        return true;
      }

      // Check merged cells
      if (worksheet.model.merges && worksheet.model.merges.length > 0) {
        return true;
      }

      // Check cell formatting
      for (let row = 1; row <= Math.min(5, worksheet.actualRowCount); row++) {
        for (let col = 1; col <= Math.min(5, worksheet.actualColumnCount); col++) {
          const cell = worksheet.getCell(row, col);
          if (cell.font || cell.fill || cell.border || cell.alignment) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private processSheetDataExcelJS(sheetName: string): {
    headers: string[];
    rows: Record<string, any>[];
  } {
    const worksheet = this.excelJSWorkbook!.getWorksheet(sheetName);
    if (!worksheet) {
      throw new Error(`Sheet "${sheetName}" not found`);
    }

    const headers: string[] = [];
    const rows: Record<string, any>[] = [];

    // Get headers
    for (let col = 1; col <= worksheet.actualColumnCount; col++) {
      const cell = worksheet.getCell(1, col);
      const cellValue = this.getCellDisplayValue(cell.value);
      headers.push(cellValue || `Column${col}`);
    }

    // Get data rows
    for (let row = 2; row <= worksheet.actualRowCount; row++) {
      const rowData: Record<string, any> = {
        __rowNum__: row,
        checkedInTime: null
      };

      for (let col = 1; col <= worksheet.actualColumnCount; col++) {
        const cell = worksheet.getCell(row, col);
        const header = headers[col - 1];
        if (header) {
          rowData[header] = this.getCellDisplayValue(cell.value);
        }
      }

      rows.push(rowData);
    }

    return { headers, rows };
  }

  private async exportWithExcelJS(
    activeSheetName: string,
    rows: any[]
  ): Promise<Uint8Array> {
    const worksheet = this.excelJSWorkbook!.getWorksheet(activeSheetName);
    if (!worksheet) {
      throw new Error(`Sheet "${activeSheetName}" not found`);
    }

    // Add new column
    const newColNum = worksheet.actualColumnCount + 1;

    // Add header with formatting
    const headerCell = worksheet.getCell(1, newColNum);
    headerCell.value = 'Checked-In At';

    // Copy formatting from A1
    const a1Cell = worksheet.getCell(1, 1);
    if (a1Cell.font) headerCell.font = { ...a1Cell.font };
    if (a1Cell.fill) headerCell.fill = { ...a1Cell.fill };
    if (a1Cell.border) headerCell.border = { ...a1Cell.border };
    if (a1Cell.alignment) headerCell.alignment = { ...a1Cell.alignment };

    // Add check-in data
    rows.forEach(row => {
      if (row.checkedInTime && row.__rowNum__) {
        const cell = worksheet.getCell(row.__rowNum__, newColNum);
        cell.value = format(new Date(row.checkedInTime), 'yyyy-MM-dd HH:mm:ss');

        // Copy formatting from corresponding row
        const refCell = worksheet.getCell(row.__rowNum__, 1);
        if (refCell.font) cell.font = { ...refCell.font };
        if (refCell.fill) cell.fill = { ...refCell.fill };
        if (refCell.border) cell.border = { ...refCell.border };
        if (refCell.alignment) cell.alignment = { ...refCell.alignment };
      }
    });

    // Set column width
    const newColumn = worksheet.getColumn(newColNum);
    newColumn.width = 20;

    // Export
    const buffer = await this.excelJSWorkbook!.xlsx.writeBuffer();
    return new Uint8Array(buffer as Buffer);
  }

  private analyzeSheetExcelJS(sheetName: string): any {
    const worksheet = this.excelJSWorkbook!.getWorksheet(sheetName);
    if (!worksheet) {
      throw new Error(`Sheet "${sheetName}" not found`);
    }

    const hasColumnWidths = worksheet.columns.some(col => col.width);
    const hasMergedCells = !!(worksheet.model.merges && worksheet.model.merges.length > 0);

    let sampleFormatting = null;
    const a1 = worksheet.getCell(1, 1);
    if (a1.font || a1.fill || a1.border || a1.alignment) {
      sampleFormatting = {
        font: a1.font,
        fill: a1.fill,
        border: a1.border,
        alignment: a1.alignment
      };
    }

    return {
      rowCount: worksheet.actualRowCount,
      columnCount: worksheet.actualColumnCount,
      hasFormatting: hasColumnWidths || hasMergedCells || !!sampleFormatting,
      formattingDetails: {
        hasColumnWidths,
        hasMergedCells,
        hasStyledCells: !!sampleFormatting,
        sampleFormatting
      },
      library: 'ExcelJS'
    };
  }

  // XLSX.js implementations (fallback)
  private detectFormattingXLSX(): boolean {
    if (!this.xlsxWorkbook) return false;

    for (const sheetName of this.xlsxWorkbook.SheetNames) {
      const sheet = this.xlsxWorkbook.Sheets[sheetName];

      if (sheet['!cols'] || sheet['!rows'] || sheet['!merges']) {
        return true;
      }

      for (const cellAddress of Object.keys(sheet)) {
        if (!cellAddress.startsWith('!')) {
          const cell = sheet[cellAddress];
          if (cell && typeof cell === 'object' && cell.s) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private processSheetDataXLSX(sheetName: string): {
    headers: string[];
    rows: Record<string, any>[];
  } {
    const worksheet = this.xlsxWorkbook!.Sheets[sheetName];
    if (!worksheet) {
      throw new Error(`Sheet "${sheetName}" not found`);
    }

    const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, {
      defval: ''
    });

    const headerSet = new Set<string>();
    jsonData.forEach(row => {
      Object.keys(row).forEach(key => headerSet.add(key));
    });

    const headers = Array.from(headerSet);
    const rows = jsonData.map((row, index) => ({
      ...row,
      __rowNum__: index + 2,
      checkedInTime: null,
    }));

    return { headers, rows };
  }

  private exportWithXLSX(activeSheetName: string, rows: any[]): Uint8Array {
    // Use the improved XLSX.js implementation
    const originalWorkbook = XLSX.read(this.originalBuffer!, {
      type: "array",
      cellStyles: true,
      cellFormula: true,
      cellDates: true,
      cellNF: true,
      bookVBA: true,
    });

    const originalWs = originalWorkbook.Sheets[activeSheetName];
    const clonedWs = this.deepCloneWorksheet(originalWs);

    // Add check-in column
    const currentRange = XLSX.utils.decode_range(clonedWs['!ref'] || 'A1:A1');
    const newColIndex = currentRange.e.c + 1;
    const newColLetter = XLSX.utils.encode_col(newColIndex);

    // Add header
    clonedWs[`${newColLetter}1`] = {
      v: 'Checked-In At',
      t: 's'
    };

    // Add data
    rows.forEach(row => {
      if (row.checkedInTime && row.__rowNum__) {
        const cellAddr = `${newColLetter}${row.__rowNum__}`;
        clonedWs[cellAddr] = {
          v: format(new Date(row.checkedInTime), 'yyyy-MM-dd HH:mm:ss'),
          t: 's'
        };
      }
    });

    // Update range
    clonedWs['!ref'] = XLSX.utils.encode_range({
      s: currentRange.s,
      e: { r: currentRange.e.r, c: newColIndex }
    });

    // Update columns
    if (clonedWs['!cols']) {
      clonedWs['!cols'] = [...clonedWs['!cols']];
      clonedWs['!cols'][newColIndex] = { width: 20 };
    }

    // Create new workbook
    const newWorkbook = this.deepCopyWorkbook(originalWorkbook);
    newWorkbook.Sheets[activeSheetName] = clonedWs;

    // Write
    return XLSX.write(newWorkbook, {
      bookType: 'xlsx',
      type: 'array',
      cellStyles: true,
      cellDates: true,
      bookVBA: true
    });
  }

  private analyzeSheetXLSX(sheetName: string): any {
    const sheet = this.xlsxWorkbook!.Sheets[sheetName];
    if (!sheet) {
      throw new Error(`Sheet "${sheetName}" not found`);
    }

    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
    const hasColumnWidths = !!sheet['!cols'];
    const hasMergedCells = !!sheet['!merges'];
    const hasStyledCells = !!sheet['A1']?.s;

    return {
      rowCount: range.e.r + 1,
      columnCount: range.e.c + 1,
      hasFormatting: hasColumnWidths || hasMergedCells || hasStyledCells,
      formattingDetails: {
        hasColumnWidths,
        hasMergedCells,
        hasStyledCells,
        sampleStyle: sheet['A1']?.s
      },
      library: 'XLSX.js'
    };
  }

  // Helper methods
  private getCellDisplayValue(cellValue: any): string {
    if (cellValue === null || cellValue === undefined) {
      return '';
    }

    // Handle different ExcelJS cell value types
    if (typeof cellValue === 'string' || typeof cellValue === 'number') {
      return String(cellValue);
    }

    // Handle Date objects
    if (cellValue instanceof Date) {
      return cellValue.toLocaleDateString();
    }

    // Handle ExcelJS rich text objects
    if (cellValue && typeof cellValue === 'object') {
      // Check if it's a rich text object
      if (cellValue.richText && Array.isArray(cellValue.richText)) {
        return cellValue.richText.map((rt: any) => rt.text || '').join('');
      }

      // Check if it's a formula result
      if (cellValue.result !== undefined) {
        return String(cellValue.result);
      }

      // Check if it has a text property
      if (cellValue.text !== undefined) {
        return String(cellValue.text);
      }

      // Check if it has a value property
      if (cellValue.value !== undefined) {
        return String(cellValue.value);
      }

      // For hyperlinks
      if (cellValue.hyperlink) {
        return cellValue.text || cellValue.hyperlink;
      }

      // Fallback to toString if it's a simple object
      try {
        const stringified = JSON.stringify(cellValue);
        if (stringified !== '{}' && stringified !== 'null') {
          return String(cellValue);
        }
      } catch (e) {
        // Ignore stringify errors
      }
    }

    return String(cellValue);
  }

  private deepCopyWorkbook(workbook: XLSX.WorkBook): XLSX.WorkBook {
    const newWorkbook = XLSX.utils.book_new();

    Object.keys(workbook.Sheets).forEach(sheetName => {
      const originalSheet = workbook.Sheets[sheetName];
      const newSheet: XLSX.WorkSheet = {};

      Object.keys(originalSheet).forEach(key => {
        const value = originalSheet[key];
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          newSheet[key] = JSON.parse(JSON.stringify(value));
        } else if (Array.isArray(value)) {
          newSheet[key] = value.map(item =>
            typeof item === 'object' && item !== null ? JSON.parse(JSON.stringify(item)) : item
          );
        } else {
          newSheet[key] = value;
        }
      });

      newWorkbook.Sheets[sheetName] = newSheet;
    });

    newWorkbook.SheetNames = [...workbook.SheetNames];
    if (workbook.Props) newWorkbook.Props = JSON.parse(JSON.stringify(workbook.Props));
    if (workbook.Custprops) newWorkbook.Custprops = JSON.parse(JSON.stringify(workbook.Custprops));
    if (workbook.Workbook) newWorkbook.Workbook = JSON.parse(JSON.stringify(workbook.Workbook));
    if (workbook.vbaraw) newWorkbook.vbaraw = workbook.vbaraw;

    return newWorkbook;
  }

  private deepCloneWorksheet(originalWs: XLSX.WorkSheet): XLSX.WorkSheet {
    const cloned: XLSX.WorkSheet = {};

    Object.keys(originalWs).forEach(key => {
      const value = originalWs[key];
      if (typeof value === 'object' && value !== null) {
        cloned[key] = JSON.parse(JSON.stringify(value));
      } else {
        cloned[key] = value;
      }
    });

    return cloned;
  }
}

/**
 * Factory function to create the best available Excel handler
 */
export async function createBestExcelHandler(): Promise<UniversalExcelHandler> {
  return new UniversalExcelHandler();
}