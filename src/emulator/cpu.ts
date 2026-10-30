// 8086 CPU Emulator Core
// Supports a subset of 8086 instructions for educational purposes

export interface CPUState {
  // General purpose registers (16-bit, split into H and L)
  AX: number; // Accumulator
  BX: number; // Base
  CX: number; // Counter
  DX: number; // Data

  // Segment registers
  SS: number; // Stack Segment
  DS: number; // Data Segment
  ES: number; // Extra Segment
  CS: number; // Code Segment

  // Pointer and Index registers
  SP: number; // Stack Pointer
  BP: number; // Base Pointer
  SI: number; // Source Index
  DI: number; // Destination Index

  // Instruction Pointer
  IP: number;

  // Flags
  OF: number; // Overflow
  DF: number; // Direction
  IF: number; // Interrupt
  TF: number; // Trap
  SF: number; // Sign
  ZF: number; // Zero
  AF: number; // Auxiliary carry
  PF: number; // Parity
  CF: number; // Carry

  // Memory (64KB)
  memory: Uint8Array;

  // State
  halted: boolean;
  error: string | null;
}

export interface ParsedInstruction {
  label?: string;
  mnemonic: string;
  operands: string[];
  originalLine: string;
  lineNumber: number;
  address: number;
}

export interface CompileResult {
  success: boolean;
  instructions: ParsedInstruction[];
  labels: Map<string, number>;
  errors: string[];
}

// Helper functions
function getHigh(val: number): number {
  return (val >> 8) & 0xFF;
}

function getLow(val: number): number {
  return val & 0xFF;
}

function makeWord(high: number, low: number): number {
  return ((high & 0xFF) << 8) | (low & 0xFF);
}

function toUnsigned16(val: number): number {
  return val & 0xFFFF;
}

function toSigned16(val: number): number {
  val = val & 0xFFFF;
  if (val > 0x7FFF) val -= 0x10000;
  return val;
}

function toUnsigned8(val: number): number {
  return val & 0xFF;
}

function toSigned8(val: number): number {
  val = val & 0xFF;
  if (val > 0x7F) val -= 0x100;
  return val;
}

function countBits(val: number): number {
  let count = 0;
  val = val & 0xFF;
  while (val) {
    count += val & 1;
    val >>= 1;
  }
  return count;
}

export function createInitialState(): CPUState {
  return {
    AX: 0, BX: 0, CX: 0, DX: 0,
    SS: 0, DS: 0, ES: 0, CS: 0,
    SP: 0, BP: 0, SI: 0, DI: 0,
    IP: 0,
    OF: 0, DF: 0, IF: 0, TF: 0,
    SF: 0, ZF: 0, AF: 0, PF: 0, CF: 0,
    memory: new Uint8Array(65536),
    halted: false,
    error: null,
  };
}

const REGISTERS_16 = ['AX', 'BX', 'CX', 'DX', 'SP', 'BP', 'SI', 'DI'];
const REGISTERS_8H = ['AH', 'BH', 'CH', 'DH'];
const REGISTERS_8L = ['AL', 'BL', 'CL', 'DL'];
const SEGMENT_REGISTERS = ['CS', 'DS', 'ES', 'SS'];

function isRegister(op: string): boolean {
  const upper = op.toUpperCase();
  return REGISTERS_16.includes(upper) ||
    REGISTERS_8H.includes(upper) ||
    REGISTERS_8L.includes(upper) ||
    SEGMENT_REGISTERS.includes(upper);
}

function is8BitRegister(op: string): boolean {
  const upper = op.toUpperCase();
  return REGISTERS_8H.includes(upper) || REGISTERS_8L.includes(upper);
}

function is16BitRegister(op: string): boolean {
  const upper = op.toUpperCase();
  return REGISTERS_16.includes(upper) || SEGMENT_REGISTERS.includes(upper);
}

function isMemoryOperand(op: string): boolean {
  return op.startsWith('[') && op.endsWith(']');
}

function parseNumber(str: string): number | null {
  str = str.trim();
  // Check for character literal
  if (str.startsWith("'") && str.endsWith("'") && str.length === 3) {
    return str.charCodeAt(1);
  }
  // Hex: 0x prefix or h suffix
  if (str.toLowerCase().startsWith('0x')) {
    const val = parseInt(str.substring(2), 16);
    return isNaN(val) ? null : val;
  }
  if (str.toLowerCase().endsWith('h')) {
    const val = parseInt(str.substring(0, str.length - 1), 16);
    return isNaN(val) ? null : val;
  }
  // Binary: b suffix
  if (str.toLowerCase().endsWith('b')) {
    const val = parseInt(str.substring(0, str.length - 1), 2);
    return isNaN(val) ? null : val;
  }
  // Decimal
  const val = parseInt(str, 10);
  return isNaN(val) ? null : val;
}

function getRegValue(cpu: CPUState, reg: string): number {
  switch (reg.toUpperCase()) {
    case 'AX': return cpu.AX;
    case 'BX': return cpu.BX;
    case 'CX': return cpu.CX;
    case 'DX': return cpu.DX;
    case 'AH': return getHigh(cpu.AX);
    case 'AL': return getLow(cpu.AX);
    case 'BH': return getHigh(cpu.BX);
    case 'BL': return getLow(cpu.BX);
    case 'CH': return getHigh(cpu.CX);
    case 'CL': return getLow(cpu.CX);
    case 'DH': return getHigh(cpu.DX);
    case 'DL': return getLow(cpu.DX);
    case 'SP': return cpu.SP;
    case 'BP': return cpu.BP;
    case 'SI': return cpu.SI;
    case 'DI': return cpu.DI;
    case 'SS': return cpu.SS;
    case 'DS': return cpu.DS;
    case 'ES': return cpu.ES;
    case 'CS': return cpu.CS;
    default: throw new Error(`Unknown register: ${reg}`);
  }
}

function setRegValue(cpu: CPUState, reg: string, val: number): void {
  switch (reg.toUpperCase()) {
    case 'AX': cpu.AX = toUnsigned16(val); break;
    case 'BX': cpu.BX = toUnsigned16(val); break;
    case 'CX': cpu.CX = toUnsigned16(val); break;
    case 'DX': cpu.DX = toUnsigned16(val); break;
    case 'AH': cpu.AX = makeWord(toUnsigned8(val), getLow(cpu.AX)); break;
    case 'AL': cpu.AX = makeWord(getHigh(cpu.AX), toUnsigned8(val)); break;
    case 'BH': cpu.BX = makeWord(toUnsigned8(val), getLow(cpu.BX)); break;
    case 'BL': cpu.BX = makeWord(getHigh(cpu.BX), toUnsigned8(val)); break;
    case 'CH': cpu.CX = makeWord(toUnsigned8(val), getLow(cpu.CX)); break;
    case 'CL': cpu.CX = makeWord(getHigh(cpu.CX), toUnsigned8(val)); break;
    case 'DH': cpu.DX = makeWord(toUnsigned8(val), getLow(cpu.DX)); break;
    case 'DL': cpu.DX = makeWord(getHigh(cpu.DX), toUnsigned8(val)); break;
    case 'SP': cpu.SP = toUnsigned16(val); break;
    case 'BP': cpu.BP = toUnsigned16(val); break;
    case 'SI': cpu.SI = toUnsigned16(val); break;
    case 'DI': cpu.DI = toUnsigned16(val); break;
    case 'SS': cpu.SS = toUnsigned16(val); break;
    case 'DS': cpu.DS = toUnsigned16(val); break;
    case 'ES': cpu.ES = toUnsigned16(val); break;
    case 'CS': cpu.CS = toUnsigned16(val); break;
    default: throw new Error(`Unknown register: ${reg}`);
  }
}

function resolveMemoryAddress(cpu: CPUState, expr: string): number {
  // Remove brackets
  let inner = expr.slice(1, -1).trim();

  // Handle simple register addressing like [BX], [SI], [DI], [BP]
  if (isRegister(inner)) {
    return getRegValue(cpu, inner);
  }

  // Handle register + offset like [BX+5], [SI+2]
  const plusMatch = inner.match(/^(\w+)\s*\+\s*(.+)$/);
  if (plusMatch) {
    const base = plusMatch[1].trim();
    const offset = plusMatch[2].trim();
    let addr = 0;
    if (isRegister(base)) {
      addr += getRegValue(cpu, base);
    }
    const num = parseNumber(offset);
    if (num !== null) {
      addr += num;
    } else if (isRegister(offset)) {
      addr += getRegValue(cpu, offset);
    }
    return toUnsigned16(addr);
  }

  const minusMatch = inner.match(/^(\w+)\s*-\s*(.+)$/);
  if (minusMatch) {
    const base = minusMatch[1].trim();
    const offset = minusMatch[2].trim();
    let addr = 0;
    if (isRegister(base)) {
      addr = getRegValue(cpu, base);
    }
    const num = parseNumber(offset);
    if (num !== null) {
      addr -= num;
    }
    return toUnsigned16(addr);
  }

  // Handle simple numeric address like [0x100]
  const num = parseNumber(inner);
  if (num !== null) {
    return toUnsigned16(num);
  }

  throw new Error(`Cannot resolve memory address: ${expr}`);
}

function getOperandValue(cpu: CPUState, op: string, labels: Map<string, number>, is8bit: boolean = false): number {
  const upper = op.toUpperCase().trim();

  // Register
  if (isRegister(upper)) {
    return getRegValue(cpu, upper);
  }

  // Memory operand
  if (isMemoryOperand(op)) {
    const addr = resolveMemoryAddress(cpu, op);
    if (is8bit) {
      return cpu.memory[addr];
    } else {
      return cpu.memory[addr] | (cpu.memory[(addr + 1) & 0xFFFF] << 8);
    }
  }

  // OFFSET keyword
  if (upper.startsWith('OFFSET ')) {
    const labelName = op.substring(7).trim();
    if (labels.has(labelName.toUpperCase())) {
      return labels.get(labelName.toUpperCase())!;
    }
  }

  // Label reference (for LEA, etc)
  if (labels.has(upper)) {
    return labels.get(upper)!;
  }

  // Immediate value
  const num = parseNumber(op);
  if (num !== null) {
    return num;
  }

  throw new Error(`Cannot resolve operand: ${op}`);
}

function setOperandValue(cpu: CPUState, op: string, val: number, is8bit: boolean = false): void {
  const upper = op.toUpperCase().trim();

  if (isRegister(upper)) {
    setRegValue(cpu, upper, val);
    return;
  }

  if (isMemoryOperand(op)) {
    const addr = resolveMemoryAddress(cpu, op);
    if (is8bit) {
      cpu.memory[addr] = toUnsigned8(val);
    } else {
      cpu.memory[addr] = val & 0xFF;
      cpu.memory[(addr + 1) & 0xFFFF] = (val >> 8) & 0xFF;
    }
    return;
  }

  throw new Error(`Cannot set value to operand: ${op}`);
}

function updateFlags(cpu: CPUState, result: number, is8bit: boolean, isArith: boolean = true, oldVal?: number, operand2?: number): void {
  const mask = is8bit ? 0xFF : 0xFFFF;
  const signBit = is8bit ? 0x80 : 0x8000;
  const masked = result & mask;

  cpu.ZF = masked === 0 ? 1 : 0;
  cpu.SF = (masked & signBit) ? 1 : 0;
  cpu.PF = (countBits(masked & 0xFF) % 2 === 0) ? 1 : 0;

  if (isArith) {
    const fullMask = is8bit ? 0x100 : 0x10000;
    cpu.CF = (result >= fullMask || result < 0) ? 1 : 0;

    // Overflow flag
    if (oldVal !== undefined && operand2 !== undefined) {
      const signedResult = is8bit ? toSigned8(masked) : toSigned16(masked);
      const maxVal = is8bit ? 127 : 32767;
      const minVal = is8bit ? -128 : -32768;
      cpu.OF = (signedResult > maxVal || signedResult < minVal) ? 1 : 0;
    }
  }
}

function pushStack(cpu: CPUState, val: number): void {
  cpu.SP = toUnsigned16(cpu.SP - 2);
  cpu.memory[cpu.SP] = val & 0xFF;
  cpu.memory[(cpu.SP + 1) & 0xFFFF] = (val >> 8) & 0xFF;
}

function popStack(cpu: CPUState): number {
  const val = cpu.memory[cpu.SP] | (cpu.memory[(cpu.SP + 1) & 0xFFFF] << 8);
  cpu.SP = toUnsigned16(cpu.SP + 2);
  return val;
}

export function compile(source: string): CompileResult {
  const lines = source.split('\n');
  const instructions: ParsedInstruction[] = [];
  const labels = new Map<string, number>();
  const errors: string[] = [];
  let address = 0;

  // Define data directives to handle
  const dataDirectives = ['DB', 'DW', 'DD'];

  // First pass: collect labels and parse instructions
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    // Remove comments
    const commentIdx = line.indexOf(';');
    if (commentIdx >= 0) {
      line = line.substring(0, commentIdx).trim();
    }

    if (line === '') continue;

    // Check for label
    let label: string | undefined;
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const potentialLabel = line.substring(0, colonIdx).trim();
      // Make sure it's not a memory operand like [BX+SI:]
      if (!potentialLabel.includes('[') && !potentialLabel.includes(']')) {
        label = potentialLabel;
        labels.set(label.toUpperCase(), address);
        line = line.substring(colonIdx + 1).trim();
        if (line === '') continue;
      }
    }

    // Parse mnemonic and operands
    const parts = line.match(/^(\S+)\s*(.*)?$/);
    if (!parts) continue;

    const mnemonic = parts[1].toUpperCase();
    let operandsStr = (parts[2] || '').trim();

    // Handle ORG directive
    if (mnemonic === 'ORG') {
      const orgVal = parseNumber(operandsStr);
      if (orgVal !== null) {
        address = orgVal;
      }
      continue;
    }

    // Handle data directives
    if (dataDirectives.includes(mnemonic)) {
      // Store data at current address
      const instruction: ParsedInstruction = {
        label,
        mnemonic,
        operands: [operandsStr],
        originalLine: lines[i],
        lineNumber: i + 1,
        address,
      };
      instructions.push(instruction);

      // Advance address based on data size
      if (mnemonic === 'DB') {
        // Parse comma-separated values or strings
        const values = parseDataValues(operandsStr);
        address += values.length;
      } else if (mnemonic === 'DW') {
        const values = operandsStr.split(',');
        address += values.length * 2;
      } else if (mnemonic === 'DD') {
        const values = operandsStr.split(',');
        address += values.length * 4;
      }
      continue;
    }

    // Parse operands (split by comma, but careful with memory operands)
    const operands: string[] = [];
    if (operandsStr) {
      let depth = 0;
      let current = '';
      for (const ch of operandsStr) {
        if (ch === '[') depth++;
        if (ch === ']') depth--;
        if (ch === ',' && depth === 0) {
          operands.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      if (current.trim()) {
        operands.push(current.trim());
      }
    }

    instructions.push({
      label,
      mnemonic,
      operands,
      originalLine: lines[i],
      lineNumber: i + 1,
      address,
    });

    address++;
  }

  return { success: errors.length === 0, instructions, labels, errors };
}

function parseDataValues(str: string): number[] {
  const values: number[] = [];
  // Handle string literals and numeric values
  let i = 0;
  while (i < str.length) {
    if (str[i] === '"' || str[i] === "'") {
      const quote = str[i];
      i++;
      while (i < str.length && str[i] !== quote) {
        values.push(str.charCodeAt(i));
        i++;
      }
      i++; // skip closing quote
    } else if (str[i] === ',' || str[i] === ' ') {
      i++;
    } else {
      let numStr = '';
      while (i < str.length && str[i] !== ',') {
        numStr += str[i];
        i++;
      }
      const num = parseNumber(numStr.trim());
      if (num !== null) {
        values.push(num & 0xFF);
      }
    }
  }
  return values;
}

export function executeInstruction(
  cpu: CPUState,
  instructions: ParsedInstruction[],
  labels: Map<string, number>,
  inputBuffer: string,
  outputCallback: (char: string) => void
): { inputConsumed: number } {
  if (cpu.halted) return { inputConsumed: 0 };

  // Find current instruction by IP
  const inst = instructions.find(i => i.address === cpu.IP);
  if (!inst) {
    cpu.halted = true;
    cpu.error = `No instruction at address ${cpu.IP}`;
    return { inputConsumed: 0 };
  }

  const { mnemonic, operands } = inst;
  let inputConsumed = 0;

  // Determine if operation is 8-bit based on operands
  const is8bit = operands.length > 0 && is8BitRegister(operands[0]);

  try {
    switch (mnemonic) {
      // Data directives - skip execution but advance IP
      case 'DB':
      case 'DW':
      case 'DD': {
        // Store data in memory at current address
        if (mnemonic === 'DB') {
          const values = parseDataValues(operands[0]);
          for (let i = 0; i < values.length; i++) {
            cpu.memory[(inst.address + i) & 0xFFFF] = values[i];
          }
        } else if (mnemonic === 'DW') {
          const parts = operands[0].split(',');
          for (let i = 0; i < parts.length; i++) {
            const val = parseNumber(parts[i].trim());
            if (val !== null) {
              cpu.memory[(inst.address + i * 2) & 0xFFFF] = val & 0xFF;
              cpu.memory[(inst.address + i * 2 + 1) & 0xFFFF] = (val >> 8) & 0xFF;
            }
          }
        }
        cpu.IP++;
        break;
      }

      // MOV - Move data
      case 'MOV': {
        const val = getOperandValue(cpu, operands[1], labels, is8bit);
        setOperandValue(cpu, operands[0], val, is8bit);
        cpu.IP++;
        break;
      }

      // XCHG - Exchange
      case 'XCHG': {
        const val1 = getOperandValue(cpu, operands[0], labels, is8bit);
        const val2 = getOperandValue(cpu, operands[1], labels, is8bit);
        setOperandValue(cpu, operands[0], val2, is8bit);
        setOperandValue(cpu, operands[1], val1, is8bit);
        cpu.IP++;
        break;
      }

      // XLAT / XLATB - Table Look-up Translation using DS:[BX + AL]
      case 'XLAT':
      case 'XLATB': {
        const offset = (cpu.BX + getLow(cpu.AX)) & 0xFFFF;
        setRegValue(cpu, 'AL', cpu.memory[offset]);
        cpu.IP++;
        break;
      }

      // LAHF - Load AH with lower 8 bits of Flag register
      case 'LAHF': {
        let lowFlags = 0x02; // Bit 1 always 1 in 8086
        lowFlags |= cpu.CF;
        lowFlags |= (cpu.PF << 2);
        lowFlags |= (cpu.AF << 4);
        lowFlags |= (cpu.ZF << 6);
        lowFlags |= (cpu.SF << 7);
        setRegValue(cpu, 'AH', lowFlags);
        cpu.IP++;
        break;
      }

      // SAHF - Store AH into lower 8 bits of Flag register
      case 'SAHF': {
        const ah = getHigh(cpu.AX);
        cpu.CF = ah & 1;
        cpu.PF = (ah >> 2) & 1;
        cpu.AF = (ah >> 4) & 1;
        cpu.ZF = (ah >> 6) & 1;
        cpu.SF = (ah >> 7) & 1;
        cpu.IP++;
        break;
      }

      // IN - Read byte or word from I/O port into Accumulator
      case 'IN': {
        if (is8bit || operands[0]?.toUpperCase() === 'AL') {
          setRegValue(cpu, 'AL', 0);
        } else {
          setRegValue(cpu, 'AX', 0);
        }
        cpu.IP++;
        break;
      }

      // OUT - Write byte or word from Accumulator to I/O port
      case 'OUT': {
        cpu.IP++;
        break;
      }

      // ADD - Addition
      case 'ADD': {
        const dest = getOperandValue(cpu, operands[0], labels, is8bit);
        const src = getOperandValue(cpu, operands[1], labels, is8bit);
        const result = dest + src;
        setOperandValue(cpu, operands[0], result, is8bit);
        updateFlags(cpu, result, is8bit, true, dest, src);
        cpu.AF = ((dest & 0xF) + (src & 0xF)) > 0xF ? 1 : 0;
        cpu.IP++;
        break;
      }

      // ADC - Add with carry
      case 'ADC': {
        const dest = getOperandValue(cpu, operands[0], labels, is8bit);
        const src = getOperandValue(cpu, operands[1], labels, is8bit);
        const result = dest + src + cpu.CF;
        setOperandValue(cpu, operands[0], result, is8bit);
        updateFlags(cpu, result, is8bit, true, dest, src);
        cpu.IP++;
        break;
      }

      // SUB - Subtract
      case 'SUB': {
        const dest = getOperandValue(cpu, operands[0], labels, is8bit);
        const src = getOperandValue(cpu, operands[1], labels, is8bit);
        const result = dest - src;
        setOperandValue(cpu, operands[0], result, is8bit);
        updateFlags(cpu, result, is8bit, true, dest, src);
        cpu.CF = dest < src ? 1 : 0;
        cpu.AF = (dest & 0xF) < (src & 0xF) ? 1 : 0;
        cpu.IP++;
        break;
      }

      // SBB - Subtract with borrow
      case 'SBB': {
        const dest = getOperandValue(cpu, operands[0], labels, is8bit);
        const src = getOperandValue(cpu, operands[1], labels, is8bit);
        const result = dest - src - cpu.CF;
        setOperandValue(cpu, operands[0], result, is8bit);
        updateFlags(cpu, result, is8bit, true, dest, src);
        cpu.CF = dest < (src + cpu.CF) ? 1 : 0;
        cpu.IP++;
        break;
      }

      // MUL - Unsigned multiply
      case 'MUL': {
        const src = getOperandValue(cpu, operands[0], labels, is8bit);
        if (is8BitRegister(operands[0])) {
          const result = getLow(cpu.AX) * src;
          cpu.AX = toUnsigned16(result);
          cpu.OF = cpu.CF = getHigh(cpu.AX) !== 0 ? 1 : 0;
        } else {
          const result = cpu.AX * src;
          cpu.AX = toUnsigned16(result);
          cpu.DX = toUnsigned16(result >> 16);
          cpu.OF = cpu.CF = cpu.DX !== 0 ? 1 : 0;
        }
        cpu.IP++;
        break;
      }

      // IMUL - Signed multiply
      case 'IMUL': {
        const src = getOperandValue(cpu, operands[0], labels, is8bit);
        if (is8BitRegister(operands[0])) {
          const result = toSigned8(getLow(cpu.AX)) * toSigned8(src);
          cpu.AX = toUnsigned16(result);
        } else {
          const result = toSigned16(cpu.AX) * toSigned16(src);
          cpu.AX = toUnsigned16(result);
          cpu.DX = toUnsigned16(result >> 16);
        }
        cpu.IP++;
        break;
      }

      // DIV - Unsigned divide
      case 'DIV': {
        const src = getOperandValue(cpu, operands[0], labels, is8bit);
        if (src === 0) {
          cpu.error = 'Division by zero';
          cpu.halted = true;
          break;
        }
        if (is8BitRegister(operands[0])) {
          const quotient = Math.floor(cpu.AX / src);
          const remainder = cpu.AX % src;
          cpu.AX = makeWord(toUnsigned8(remainder), toUnsigned8(quotient));
        } else {
          const dividend = (cpu.DX << 16) | cpu.AX;
          const quotient = Math.floor(dividend / src);
          const remainder = dividend % src;
          cpu.AX = toUnsigned16(quotient);
          cpu.DX = toUnsigned16(remainder);
        }
        cpu.IP++;
        break;
      }

      // IDIV - Signed divide
      case 'IDIV': {
        const src = getOperandValue(cpu, operands[0], labels, is8bit);
        if (src === 0) {
          cpu.error = 'Division by zero';
          cpu.halted = true;
          break;
        }
        if (is8BitRegister(operands[0])) {
          const dividend = toSigned16(cpu.AX);
          const divisor = toSigned8(src);
          const quotient = Math.trunc(dividend / divisor);
          const remainder = dividend % divisor;
          cpu.AX = makeWord(toUnsigned8(remainder), toUnsigned8(quotient));
        } else {
          const dividend = toSigned16((cpu.DX << 16) | cpu.AX);
          const divisor = toSigned16(src);
          const quotient = Math.trunc(dividend / divisor);
          const remainder = dividend % divisor;
          cpu.AX = toUnsigned16(quotient);
          cpu.DX = toUnsigned16(remainder);
        }
        cpu.IP++;
        break;
      }

      // INC - Increment
      case 'INC': {
        const val = getOperandValue(cpu, operands[0], labels, is8bit);
        const result = val + 1;
        setOperandValue(cpu, operands[0], result, is8bit);
        const savedCF = cpu.CF;
        updateFlags(cpu, result, is8bit, true, val, 1);
        cpu.CF = savedCF; // INC doesn't affect CF
        cpu.AF = (val & 0xF) === 0xF ? 1 : 0;
        cpu.IP++;
        break;
      }

      // DEC - Decrement
      case 'DEC': {
        const val = getOperandValue(cpu, operands[0], labels, is8bit);
        const result = val - 1;
        setOperandValue(cpu, operands[0], result, is8bit);
        const savedCF = cpu.CF;
        updateFlags(cpu, result, is8bit, true, val, 1);
        cpu.CF = savedCF; // DEC doesn't affect CF
        cpu.AF = (val & 0xF) === 0 ? 1 : 0;
        cpu.IP++;
        break;
      }

      // NEG / NPG - Negate (Two's complement)
      case 'NEG':
      case 'NPG': {
        const val = getOperandValue(cpu, operands[0], labels, is8bit);
        const result = -val;
        setOperandValue(cpu, operands[0], result, is8bit);
        updateFlags(cpu, result, is8bit);
        cpu.CF = val !== 0 ? 1 : 0;
        cpu.IP++;
        break;
      }

      // CMP - Compare
      case 'CMP': {
        const dest = getOperandValue(cpu, operands[0], labels, is8bit);
        const src = getOperandValue(cpu, operands[1], labels, is8bit);
        const result = dest - src;
        updateFlags(cpu, result, is8bit, true, dest, src);
        cpu.CF = dest < src ? 1 : 0;
        cpu.AF = (dest & 0xF) < (src & 0xF) ? 1 : 0;
        cpu.IP++;
        break;
      }

      // AND - Logical AND
      case 'AND': {
        const dest = getOperandValue(cpu, operands[0], labels, is8bit);
        const src = getOperandValue(cpu, operands[1], labels, is8bit);
        const result = dest & src;
        setOperandValue(cpu, operands[0], result, is8bit);
        updateFlags(cpu, result, is8bit, false);
        cpu.CF = 0;
        cpu.OF = 0;
        cpu.IP++;
        break;
      }

      // OR - Logical OR
      case 'OR': {
        const dest = getOperandValue(cpu, operands[0], labels, is8bit);
        const src = getOperandValue(cpu, operands[1], labels, is8bit);
        const result = dest | src;
        setOperandValue(cpu, operands[0], result, is8bit);
        updateFlags(cpu, result, is8bit, false);
        cpu.CF = 0;
        cpu.OF = 0;
        cpu.IP++;
        break;
      }

      // XOR - Logical XOR
      case 'XOR': {
        const dest = getOperandValue(cpu, operands[0], labels, is8bit);
        const src = getOperandValue(cpu, operands[1], labels, is8bit);
        const result = dest ^ src;
        setOperandValue(cpu, operands[0], result, is8bit);
        updateFlags(cpu, result, is8bit, false);
        cpu.CF = 0;
        cpu.OF = 0;
        cpu.IP++;
        break;
      }

      // NOT - Logical NOT
      case 'NOT': {
        const val = getOperandValue(cpu, operands[0], labels, is8bit);
        const mask = is8bit ? 0xFF : 0xFFFF;
        setOperandValue(cpu, operands[0], ~val & mask, is8bit);
        cpu.IP++;
        break;
      }

      // TEST - Logical compare
      case 'TEST': {
        const dest = getOperandValue(cpu, operands[0], labels, is8bit);
        const src = getOperandValue(cpu, operands[1], labels, is8bit);
        const result = dest & src;
        updateFlags(cpu, result, is8bit, false);
        cpu.CF = 0;
        cpu.OF = 0;
        cpu.IP++;
        break;
      }

      // SHL/SAL - Shift left
      case 'SHL':
      case 'SAL': {
        const val = getOperandValue(cpu, operands[0], labels, is8bit);
        const count = operands.length > 1 ? getOperandValue(cpu, operands[1], labels, true) : 1;
        const result = val << count;
        setOperandValue(cpu, operands[0], result, is8bit);
        updateFlags(cpu, result, is8bit);
        if (count === 1) {
          const signBit = is8bit ? 7 : 15;
          cpu.OF = ((result >> signBit) & 1) !== cpu.CF ? 1 : 0;
        }
        cpu.IP++;
        break;
      }

      // SHR - Shift right (unsigned)
      case 'SHR': {
        const val = getOperandValue(cpu, operands[0], labels, is8bit);
        const count = operands.length > 1 ? getOperandValue(cpu, operands[1], labels, true) : 1;
        cpu.CF = (val >> (count - 1)) & 1;
        const result = val >>> count;
        setOperandValue(cpu, operands[0], result, is8bit);
        updateFlags(cpu, result, is8bit, false);
        cpu.IP++;
        break;
      }

      // SAR - Shift right (signed)
      case 'SAR': {
        const val = getOperandValue(cpu, operands[0], labels, is8bit);
        const count = operands.length > 1 ? getOperandValue(cpu, operands[1], labels, true) : 1;
        cpu.CF = (val >> (count - 1)) & 1;
        const signedVal = is8bit ? toSigned8(val) : toSigned16(val);
        const result = signedVal >> count;
        setOperandValue(cpu, operands[0], result, is8bit);
        updateFlags(cpu, result, is8bit, false);
        cpu.IP++;
        break;
      }

      // ROL - Rotate left
      case 'ROL': {
        const val = getOperandValue(cpu, operands[0], labels, is8bit);
        const count = operands.length > 1 ? getOperandValue(cpu, operands[1], labels, true) : 1;
        const bits = is8bit ? 8 : 16;
        const result = ((val << count) | (val >>> (bits - count))) & (is8bit ? 0xFF : 0xFFFF);
        setOperandValue(cpu, operands[0], result, is8bit);
        cpu.CF = result & 1;
        cpu.IP++;
        break;
      }

      // ROR - Rotate right
      case 'ROR': {
        const val = getOperandValue(cpu, operands[0], labels, is8bit);
        const count = operands.length > 1 ? getOperandValue(cpu, operands[1], labels, true) : 1;
        const bits = is8bit ? 8 : 16;
        const result = ((val >>> count) | (val << (bits - count))) & (is8bit ? 0xFF : 0xFFFF);
        setOperandValue(cpu, operands[0], result, is8bit);
        cpu.CF = (result >> (bits - 1)) & 1;
        cpu.IP++;
        break;
      }

      // RCL - Rotate left through Carry
      case 'RCL': {
        let val = getOperandValue(cpu, operands[0], labels, is8bit);
        const count = operands.length > 1 ? getOperandValue(cpu, operands[1], labels, true) : 1;
        const bits = is8bit ? 8 : 16;
        for (let c = 0; c < count; c++) {
          const oldCF = cpu.CF;
          const msb = (val >> (bits - 1)) & 1;
          val = ((val << 1) | oldCF) & (is8bit ? 0xFF : 0xFFFF);
          cpu.CF = msb;
        }
        setOperandValue(cpu, operands[0], val, is8bit);
        cpu.IP++;
        break;
      }

      // RCR - Rotate right through Carry
      case 'RCR': {
        let val = getOperandValue(cpu, operands[0], labels, is8bit);
        const count = operands.length > 1 ? getOperandValue(cpu, operands[1], labels, true) : 1;
        const bits = is8bit ? 8 : 16;
        for (let c = 0; c < count; c++) {
          const oldCF = cpu.CF;
          const lsb = val & 1;
          val = ((val >>> 1) | (oldCF << (bits - 1))) & (is8bit ? 0xFF : 0xFFFF);
          cpu.CF = lsb;
        }
        setOperandValue(cpu, operands[0], val, is8bit);
        cpu.IP++;
        break;
      }

      // PUSH / PPUSH - Push to stack
      case 'PUSH':
      case 'PPUSH': {
        const val = getOperandValue(cpu, operands[0], labels, false);
        pushStack(cpu, val);
        cpu.IP++;
        break;
      }

      // PUSHA - Push all general registers (AX, CX, DX, BX, original SP, BP, SI, DI)
      case 'PUSHA': {
        const origSP = cpu.SP;
        pushStack(cpu, cpu.AX);
        pushStack(cpu, cpu.CX);
        pushStack(cpu, cpu.DX);
        pushStack(cpu, cpu.BX);
        pushStack(cpu, origSP);
        pushStack(cpu, cpu.BP);
        pushStack(cpu, cpu.SI);
        pushStack(cpu, cpu.DI);
        cpu.IP++;
        break;
      }

      // POP - Pop from stack
      case 'POP': {
        const val = popStack(cpu);
        setOperandValue(cpu, operands[0], val, false);
        cpu.IP++;
        break;
      }

      // POPA - Pop all general registers in reverse order
      case 'POPA': {
        cpu.DI = popStack(cpu);
        cpu.SI = popStack(cpu);
        cpu.BP = popStack(cpu);
        popStack(cpu); // discard stored SP
        cpu.BX = popStack(cpu);
        cpu.DX = popStack(cpu);
        cpu.CX = popStack(cpu);
        cpu.AX = popStack(cpu);
        cpu.IP++;
        break;
      }

      // PUSHF - Push flags
      case 'PUSHF': {
        let flags = 0;
        flags |= cpu.CF;
        flags |= (cpu.PF << 2);
        flags |= (cpu.AF << 4);
        flags |= (cpu.ZF << 6);
        flags |= (cpu.SF << 7);
        flags |= (cpu.TF << 8);
        flags |= (cpu.IF << 9);
        flags |= (cpu.DF << 10);
        flags |= (cpu.OF << 11);
        pushStack(cpu, flags);
        cpu.IP++;
        break;
      }

      // POPF - Pop flags
      case 'POPF': {
        const flags = popStack(cpu);
        cpu.CF = flags & 1;
        cpu.PF = (flags >> 2) & 1;
        cpu.AF = (flags >> 4) & 1;
        cpu.ZF = (flags >> 6) & 1;
        cpu.SF = (flags >> 7) & 1;
        cpu.TF = (flags >> 8) & 1;
        cpu.IF = (flags >> 9) & 1;
        cpu.DF = (flags >> 10) & 1;
        cpu.OF = (flags >> 11) & 1;
        cpu.IP++;
        break;
      }

      // LEA - Load effective address
      case 'LEA': {
        if (isMemoryOperand(operands[1])) {
          const addr = resolveMemoryAddress(cpu, operands[1]);
          setRegValue(cpu, operands[0], addr);
        }
        cpu.IP++;
        break;
      }

      // LDS - Load pointer into DS and general register
      case 'LDS': {
        if (isMemoryOperand(operands[1])) {
          const addr = resolveMemoryAddress(cpu, operands[1]);
          const regVal = cpu.memory[addr] | (cpu.memory[(addr + 1) & 0xFFFF] << 8);
          const dsVal = cpu.memory[(addr + 2) & 0xFFFF] | (cpu.memory[(addr + 3) & 0xFFFF] << 8);
          setRegValue(cpu, operands[0], regVal);
          cpu.DS = dsVal;
        }
        cpu.IP++;
        break;
      }

      // LES - Load pointer into ES and general register
      case 'LES': {
        if (isMemoryOperand(operands[1])) {
          const addr = resolveMemoryAddress(cpu, operands[1]);
          const regVal = cpu.memory[addr] | (cpu.memory[(addr + 1) & 0xFFFF] << 8);
          const esVal = cpu.memory[(addr + 2) & 0xFFFF] | (cpu.memory[(addr + 3) & 0xFFFF] << 8);
          setRegValue(cpu, operands[0], regVal);
          cpu.ES = esVal;
        }
        cpu.IP++;
        break;
      }

      // Jump instructions
      case 'JMP': {
        const target = labels.get(operands[0].toUpperCase());
        if (target !== undefined) {
          cpu.IP = target;
        } else {
          cpu.error = `Label not found: ${operands[0]}`;
          cpu.halted = true;
        }
        break;
      }

      case 'JE':
      case 'JZ': {
        const target = labels.get(operands[0].toUpperCase());
        if (target !== undefined) {
          cpu.IP = cpu.ZF === 1 ? target : cpu.IP + 1;
        } else {
          cpu.error = `Label not found: ${operands[0]}`;
          cpu.halted = true;
        }
        break;
      }

      case 'JNE':
      case 'JNZ': {
        const target = labels.get(operands[0].toUpperCase());
        if (target !== undefined) {
          cpu.IP = cpu.ZF === 0 ? target : cpu.IP + 1;
        } else {
          cpu.error = `Label not found: ${operands[0]}`;
          cpu.halted = true;
        }
        break;
      }

      case 'JG':
      case 'JNLE': {
        const target = labels.get(operands[0].toUpperCase());
        if (target !== undefined) {
          cpu.IP = (cpu.ZF === 0 && cpu.SF === cpu.OF) ? target : cpu.IP + 1;
        } else {
          cpu.error = `Label not found: ${operands[0]}`;
          cpu.halted = true;
        }
        break;
      }

      case 'JGE':
      case 'JNL': {
        const target = labels.get(operands[0].toUpperCase());
        if (target !== undefined) {
          cpu.IP = (cpu.SF === cpu.OF) ? target : cpu.IP + 1;
        } else {
          cpu.error = `Label not found: ${operands[0]}`;
          cpu.halted = true;
        }
        break;
      }

      case 'JL':
      case 'JNGE': {
        const target = labels.get(operands[0].toUpperCase());
        if (target !== undefined) {
          cpu.IP = (cpu.SF !== cpu.OF) ? target : cpu.IP + 1;
        } else {
          cpu.error = `Label not found: ${operands[0]}`;
          cpu.halted = true;
        }
        break;
      }

      case 'JLE':
      case 'JNG': {
        const target = labels.get(operands[0].toUpperCase());
        if (target !== undefined) {
          cpu.IP = (cpu.ZF === 1 || cpu.SF !== cpu.OF) ? target : cpu.IP + 1;
        } else {
          cpu.error = `Label not found: ${operands[0]}`;
          cpu.halted = true;
        }
        break;
      }

      case 'JA':
      case 'JNBE': {
        const target = labels.get(operands[0].toUpperCase());
        if (target !== undefined) {
          cpu.IP = (cpu.CF === 0 && cpu.ZF === 0) ? target : cpu.IP + 1;
        } else {
          cpu.error = `Label not found: ${operands[0]}`;
          cpu.halted = true;
        }
        break;
      }

      case 'JAE':
      case 'JNB':
      case 'JNC': {
        const target = labels.get(operands[0].toUpperCase());
        if (target !== undefined) {
          cpu.IP = cpu.CF === 0 ? target : cpu.IP + 1;
        } else {
          cpu.error = `Label not found: ${operands[0]}`;
          cpu.halted = true;
        }
        break;
      }

      case 'JB':
      case 'JNAE':
      case 'JC': {
        const target = labels.get(operands[0].toUpperCase());
        if (target !== undefined) {
          cpu.IP = cpu.CF === 1 ? target : cpu.IP + 1;
        } else {
          cpu.error = `Label not found: ${operands[0]}`;
          cpu.halted = true;
        }
        break;
      }

      case 'JBE':
      case 'JNA': {
        const target = labels.get(operands[0].toUpperCase());
        if (target !== undefined) {
          cpu.IP = (cpu.CF === 1 || cpu.ZF === 1) ? target : cpu.IP + 1;
        } else {
          cpu.error = `Label not found: ${operands[0]}`;
          cpu.halted = true;
        }
        break;
      }

      case 'JO': {
        const target = labels.get(operands[0].toUpperCase());
        if (target !== undefined) {
          cpu.IP = cpu.OF === 1 ? target : cpu.IP + 1;
        } else { cpu.error = `Label not found: ${operands[0]}`; cpu.halted = true; }
        break;
      }

      case 'JNO': {
        const target = labels.get(operands[0].toUpperCase());
        if (target !== undefined) {
          cpu.IP = cpu.OF === 0 ? target : cpu.IP + 1;
        } else { cpu.error = `Label not found: ${operands[0]}`; cpu.halted = true; }
        break;
      }

      case 'JS': {
        const target = labels.get(operands[0].toUpperCase());
        if (target !== undefined) {
          cpu.IP = cpu.SF === 1 ? target : cpu.IP + 1;
        } else { cpu.error = `Label not found: ${operands[0]}`; cpu.halted = true; }
        break;
      }

      case 'JNS': {
        const target = labels.get(operands[0].toUpperCase());
        if (target !== undefined) {
          cpu.IP = cpu.SF === 0 ? target : cpu.IP + 1;
        } else { cpu.error = `Label not found: ${operands[0]}`; cpu.halted = true; }
        break;
      }

      case 'JP':
      case 'JPE': {
        const target = labels.get(operands[0].toUpperCase());
        if (target !== undefined) {
          cpu.IP = cpu.PF === 1 ? target : cpu.IP + 1;
        } else { cpu.error = `Label not found: ${operands[0]}`; cpu.halted = true; }
        break;
      }

      case 'JNP':
      case 'JPO': {
        const target = labels.get(operands[0].toUpperCase());
        if (target !== undefined) {
          cpu.IP = cpu.PF === 0 ? target : cpu.IP + 1;
        } else { cpu.error = `Label not found: ${operands[0]}`; cpu.halted = true; }
        break;
      }

      case 'JCXZ': {
        const target = labels.get(operands[0].toUpperCase());
        if (target !== undefined) {
          cpu.IP = cpu.CX === 0 ? target : cpu.IP + 1;
        } else { cpu.error = `Label not found: ${operands[0]}`; cpu.halted = true; }
        break;
      }

      // LOOP instructions
      case 'LOOP': {
        cpu.CX = toUnsigned16(cpu.CX - 1);
        const target = labels.get(operands[0].toUpperCase());
        if (target !== undefined) {
          cpu.IP = cpu.CX !== 0 ? target : cpu.IP + 1;
        } else { cpu.error = `Label not found: ${operands[0]}`; cpu.halted = true; }
        break;
      }

      case 'LOOPE':
      case 'LOOPZ': {
        cpu.CX = toUnsigned16(cpu.CX - 1);
        const target = labels.get(operands[0].toUpperCase());
        if (target !== undefined) {
          cpu.IP = (cpu.CX !== 0 && cpu.ZF === 1) ? target : cpu.IP + 1;
        } else { cpu.error = `Label not found: ${operands[0]}`; cpu.halted = true; }
        break;
      }

      case 'LOOPNE':
      case 'LOOPNZ': {
        cpu.CX = toUnsigned16(cpu.CX - 1);
        const target = labels.get(operands[0].toUpperCase());
        if (target !== undefined) {
          cpu.IP = (cpu.CX !== 0 && cpu.ZF === 0) ? target : cpu.IP + 1;
        } else { cpu.error = `Label not found: ${operands[0]}`; cpu.halted = true; }
        break;
      }

      // CALL - Call subroutine
      case 'CALL': {
        const target = labels.get(operands[0].toUpperCase());
        if (target !== undefined) {
          pushStack(cpu, cpu.IP + 1);
          cpu.IP = target;
        } else {
          cpu.error = `Label not found: ${operands[0]}`;
          cpu.halted = true;
        }
        break;
      }

      // RET - Return from subroutine
      case 'RET': {
        cpu.IP = popStack(cpu);
        break;
      }

      // INT - Interrupt
      case 'INT': {
        const intNum = parseNumber(operands[0]);
        if (intNum === 0x21 || intNum === 33) {
          // DOS interrupt 21h
          const ah = getHigh(cpu.AX);
          switch (ah) {
            case 0x01: {
              // Read character with echo
              if (inputBuffer.length > 0) {
                const ch = inputBuffer.charCodeAt(0);
                setRegValue(cpu, 'AL', ch);
                outputCallback(inputBuffer[0]);
                inputConsumed = 1;
              } else {
                setRegValue(cpu, 'AL', 0);
              }
              break;
            }
            case 0x02: {
              // Display character
              const dl = getLow(cpu.DX);
              outputCallback(String.fromCharCode(dl));
              break;
            }
            case 0x09: {
              // Display string (terminated by $)
              let addr = cpu.DX;
              let ch = cpu.memory[addr];
              while (ch !== 0x24 && addr < 0xFFFF) { // $ = 0x24
                outputCallback(String.fromCharCode(ch));
                addr++;
                ch = cpu.memory[addr];
              }
              break;
            }
            case 0x0A: {
              // Buffered input
              const maxLen = Math.min(inputBuffer.length, 255);
              const bufAddr = cpu.DX;
              cpu.memory[bufAddr] = maxLen;
              cpu.memory[bufAddr + 1] = maxLen;
              for (let i = 0; i < maxLen; i++) {
                cpu.memory[bufAddr + 2 + i] = inputBuffer.charCodeAt(i);
              }
              cpu.memory[bufAddr + 2 + maxLen] = 0x0D; // CR
              inputConsumed = maxLen;
              break;
            }
            case 0x4C: {
              // Terminate program
              cpu.halted = true;
              break;
            }
            default:
              break;
          }
        } else if (intNum === 0x10 || intNum === 16) {
          // BIOS video interrupt - simplified
          const ah = getHigh(cpu.AX);
          if (ah === 0x0E) {
            // Teletype output
            outputCallback(String.fromCharCode(getLow(cpu.AX)));
          }
        }
        cpu.IP++;
        break;
      }

      // HLT - Halt
      case 'HLT': {
        cpu.halted = true;
        cpu.IP++;
        break;
      }

      // NOP - No operation
      case 'NOP': {
        cpu.IP++;
        break;
      }

      // CLC - Clear carry flag
      case 'CLC': { cpu.CF = 0; cpu.IP++; break; }
      case 'STC': { cpu.CF = 1; cpu.IP++; break; }
      case 'CMC': { cpu.CF = cpu.CF ? 0 : 1; cpu.IP++; break; }
      case 'CLD': { cpu.DF = 0; cpu.IP++; break; }
      case 'STD': { cpu.DF = 1; cpu.IP++; break; }
      case 'CLI': { cpu.IF = 0; cpu.IP++; break; }
      case 'STI': { cpu.IF = 1; cpu.IP++; break; }

      // CBW - Convert byte to word
      case 'CBW': {
        const al = toSigned8(getLow(cpu.AX));
        cpu.AX = toUnsigned16(al);
        cpu.IP++;
        break;
      }

      // CWD - Convert word to doubleword
      case 'CWD': {
        const ax = toSigned16(cpu.AX);
        cpu.DX = ax < 0 ? 0xFFFF : 0x0000;
        cpu.IP++;
        break;
      }

      // String operations
      case 'MOVS':
      case 'MOVSB': {
        cpu.memory[cpu.DI] = cpu.memory[cpu.SI];
        if (cpu.DF === 0) { cpu.SI++; cpu.DI++; }
        else { cpu.SI--; cpu.DI--; }
        cpu.SI = toUnsigned16(cpu.SI);
        cpu.DI = toUnsigned16(cpu.DI);
        cpu.IP++;
        break;
      }

      case 'MOVSW': {
        cpu.memory[cpu.DI] = cpu.memory[cpu.SI];
        cpu.memory[(cpu.DI + 1) & 0xFFFF] = cpu.memory[(cpu.SI + 1) & 0xFFFF];
        if (cpu.DF === 0) { cpu.SI += 2; cpu.DI += 2; }
        else { cpu.SI -= 2; cpu.DI -= 2; }
        cpu.SI = toUnsigned16(cpu.SI);
        cpu.DI = toUnsigned16(cpu.DI);
        cpu.IP++;
        break;
      }

      case 'CMPS':
      case 'CMPSB':
      case 'COMPSB': {
        const b1 = cpu.memory[cpu.SI];
        const b2 = cpu.memory[cpu.DI];
        const res = b1 - b2;
        updateFlags(cpu, res, true, true, b1, b2);
        cpu.CF = b1 < b2 ? 1 : 0;
        cpu.AF = (b1 & 0xF) < (b2 & 0xF) ? 1 : 0;
        if (cpu.DF === 0) { cpu.SI++; cpu.DI++; }
        else { cpu.SI--; cpu.DI--; }
        cpu.SI = toUnsigned16(cpu.SI);
        cpu.DI = toUnsigned16(cpu.DI);
        cpu.IP++;
        break;
      }

      case 'CMPSW':
      case 'COMPSW': {
        const w1 = cpu.memory[cpu.SI] | (cpu.memory[(cpu.SI + 1) & 0xFFFF] << 8);
        const w2 = cpu.memory[cpu.DI] | (cpu.memory[(cpu.DI + 1) & 0xFFFF] << 8);
        const res = w1 - w2;
        updateFlags(cpu, res, false, true, w1, w2);
        cpu.CF = w1 < w2 ? 1 : 0;
        if (cpu.DF === 0) { cpu.SI += 2; cpu.DI += 2; }
        else { cpu.SI -= 2; cpu.DI -= 2; }
        cpu.SI = toUnsigned16(cpu.SI);
        cpu.DI = toUnsigned16(cpu.DI);
        cpu.IP++;
        break;
      }

      case 'SCAS':
      case 'SCASB': {
        const al = getLow(cpu.AX);
        const memByte = cpu.memory[cpu.DI];
        const res = al - memByte;
        updateFlags(cpu, res, true, true, al, memByte);
        cpu.CF = al < memByte ? 1 : 0;
        cpu.AF = (al & 0xF) < (memByte & 0xF) ? 1 : 0;
        cpu.DI = toUnsigned16(cpu.DF === 0 ? cpu.DI + 1 : cpu.DI - 1);
        cpu.IP++;
        break;
      }

      case 'SCASW': {
        const ax = cpu.AX;
        const memWord = cpu.memory[cpu.DI] | (cpu.memory[(cpu.DI + 1) & 0xFFFF] << 8);
        const res = ax - memWord;
        updateFlags(cpu, res, false, true, ax, memWord);
        cpu.CF = ax < memWord ? 1 : 0;
        cpu.DI = toUnsigned16(cpu.DF === 0 ? cpu.DI + 2 : cpu.DI - 2);
        cpu.IP++;
        break;
      }

      case 'LODS':
      case 'LODSB': {
        setRegValue(cpu, 'AL', cpu.memory[cpu.SI]);
        cpu.SI = toUnsigned16(cpu.DF === 0 ? cpu.SI + 1 : cpu.SI - 1);
        cpu.IP++;
        break;
      }

      case 'LODSW': {
        cpu.AX = cpu.memory[cpu.SI] | (cpu.memory[(cpu.SI + 1) & 0xFFFF] << 8);
        cpu.SI = toUnsigned16(cpu.DF === 0 ? cpu.SI + 2 : cpu.SI - 2);
        cpu.IP++;
        break;
      }

      case 'STOS':
      case 'STOSB': {
        cpu.memory[cpu.DI] = getLow(cpu.AX);
        cpu.DI = toUnsigned16(cpu.DF === 0 ? cpu.DI + 1 : cpu.DI - 1);
        cpu.IP++;
        break;
      }

      case 'STOSW': {
        cpu.memory[cpu.DI] = cpu.AX & 0xFF;
        cpu.memory[(cpu.DI + 1) & 0xFFFF] = (cpu.AX >> 8) & 0xFF;
        cpu.DI = toUnsigned16(cpu.DF === 0 ? cpu.DI + 2 : cpu.DI - 2);
        cpu.IP++;
        break;
      }

      case 'INS':
      case 'INSB': {
        cpu.memory[cpu.DI] = 0;
        cpu.DI = toUnsigned16(cpu.DF === 0 ? cpu.DI + 1 : cpu.DI - 1);
        cpu.IP++;
        break;
      }

      case 'INSW': {
        cpu.memory[cpu.DI] = 0;
        cpu.memory[(cpu.DI + 1) & 0xFFFF] = 0;
        cpu.DI = toUnsigned16(cpu.DF === 0 ? cpu.DI + 2 : cpu.DI - 2);
        cpu.IP++;
        break;
      }

      case 'OUTS':
      case 'OUTSB': {
        cpu.SI = toUnsigned16(cpu.DF === 0 ? cpu.SI + 1 : cpu.SI - 1);
        cpu.IP++;
        break;
      }

      case 'OUTSW': {
        cpu.SI = toUnsigned16(cpu.DF === 0 ? cpu.SI + 2 : cpu.SI - 2);
        cpu.IP++;
        break;
      }

      // Repeat Prefixes
      case 'REP':
      case 'REPE':
      case 'REPZ':
      case 'REPNE':
      case 'REPNZ': {
        cpu.IP++;
        break;
      }

      // DAA - Decimal Adjust for Addition
      case 'DAA': {
        let al = getLow(cpu.AX);
        if ((al & 0x0F) > 9 || cpu.AF === 1) {
          al += 6;
          cpu.AF = 1;
        }
        if (al > 0x9F || cpu.CF === 1) {
          al += 0x60;
          cpu.CF = 1;
        }
        setRegValue(cpu, 'AL', al);
        cpu.IP++;
        break;
      }

      // DAS - Decimal Adjust for Subtraction
      case 'DAS': {
        let al = getLow(cpu.AX);
        if ((al & 0x0F) > 9 || cpu.AF === 1) {
          al = (al - 6) & 0xFF;
          cpu.AF = 1;
        }
        if (al > 0x9F || cpu.CF === 1) {
          al = (al - 0x60) & 0xFF;
          cpu.CF = 1;
        }
        setRegValue(cpu, 'AL', al);
        cpu.IP++;
        break;
      }

      // AAA - ASCII Adjust for Addition
      case 'AAA': {
        let al = getLow(cpu.AX);
        if ((al & 0x0F) > 9 || cpu.AF === 1) {
          cpu.AX = toUnsigned16(cpu.AX + 0x106);
          cpu.AF = 1;
          cpu.CF = 1;
        } else {
          cpu.AF = 0;
          cpu.CF = 0;
        }
        cpu.AX = cpu.AX & 0xFF0F;
        cpu.IP++;
        break;
      }

      // AAS - ASCII Adjust for Subtraction
      case 'AAS': {
        let al = getLow(cpu.AX);
        let ah = getHigh(cpu.AX);
        if ((al & 0x0F) > 9 || cpu.AF === 1) {
          al = (al - 6) & 0xFF;
          ah = (ah - 1) & 0xFF;
          cpu.AF = 1;
          cpu.CF = 1;
        } else {
          cpu.AF = 0;
          cpu.CF = 0;
        }
        cpu.AX = makeWord(ah, al & 0x0F);
        cpu.IP++;
        break;
      }

      // AAM - ASCII Adjust after Multiplication
      case 'AAM': {
        const al = getLow(cpu.AX);
        const ah = Math.floor(al / 10);
        const newAl = al % 10;
        cpu.AX = makeWord(toUnsigned8(ah), toUnsigned8(newAl));
        updateFlags(cpu, newAl, true, false);
        cpu.IP++;
        break;
      }

      // AAD - ASCII Adjust before Division
      case 'AAD': {
        const ah = getHigh(cpu.AX);
        const al = getLow(cpu.AX);
        const newAl = (ah * 10 + al) & 0xFF;
        cpu.AX = makeWord(0, newAl);
        updateFlags(cpu, newAl, true, false);
        cpu.IP++;
        break;
      }

      // INTO - Interrupt on Overflow
      case 'INTO': {
        if (cpu.OF === 1) {
          pushStack(cpu, cpu.IP + 1);
          let flags = cpu.CF | (cpu.PF << 2) | (cpu.AF << 4) | (cpu.ZF << 6) | (cpu.SF << 7) | (cpu.TF << 8) | (cpu.IF << 9) | (cpu.DF << 10) | (cpu.OF << 11);
          pushStack(cpu, flags);
          cpu.IF = 0;
          cpu.TF = 0;
        }
        cpu.IP++;
        break;
      }

      // IRET - Return from Interrupt Service Routine
      case 'IRET': {
        const flags = popStack(cpu);
        cpu.CF = flags & 1;
        cpu.PF = (flags >> 2) & 1;
        cpu.AF = (flags >> 4) & 1;
        cpu.ZF = (flags >> 6) & 1;
        cpu.SF = (flags >> 7) & 1;
        cpu.TF = (flags >> 8) & 1;
        cpu.IF = (flags >> 9) & 1;
        cpu.DF = (flags >> 10) & 1;
        cpu.OF = (flags >> 11) & 1;
        cpu.IP = popStack(cpu);
        break;
      }

      default: {
        cpu.error = `Unknown instruction: ${mnemonic}`;
        cpu.halted = true;
        break;
      }
    }
  } catch (e: any) {
    cpu.error = e.message || 'Execution error';
    cpu.halted = true;
  }

  return { inputConsumed };
}

export function getRegisterH(cpu: CPUState, reg: string): number {
  switch (reg) {
    case 'A': return getHigh(cpu.AX);
    case 'B': return getHigh(cpu.BX);
    case 'C': return getHigh(cpu.CX);
    case 'D': return getHigh(cpu.DX);
    default: return 0;
  }
}

export function getRegisterL(cpu: CPUState, reg: string): number {
  switch (reg) {
    case 'A': return getLow(cpu.AX);
    case 'B': return getLow(cpu.BX);
    case 'C': return getLow(cpu.CX);
    case 'D': return getLow(cpu.DX);
    default: return 0;
  }
}
