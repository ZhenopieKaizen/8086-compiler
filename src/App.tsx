import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import {
  createInitialState,
  compile,
  executeInstruction,
  getRegisterH,
  getRegisterL,
  type CPUState,
  type CompileResult,
} from './emulator/cpu'
import {
  INSTRUCTION_CATEGORIES,
  INSTRUCTION_DATABASE,
  STORAGE_UNITS,
  CPU_INTERNAL_REGISTERS,
} from './emulator/instructionSets'

const DEFAULT_CODE = `start:
    CALL COUNT_UP          ; Call the subroutine to count up 2 times
    CALL COUNT_DOWN        ; Call the subroutine to count down 3 times
    HLT                   ; Halt the processor

COUNT_UP:
    MOV AL, 0x00          ; Initialize AL to 0
UP_LOOP:
    INC AL                ; Increment AL
    CMP AL, 0x02          ; Compare to 2
    JNE UP_LOOP           ; Jump back if not equal
    RET                   ; Return to the main program

COUNT_DOWN:
    MOV AL, 0x03          ; Set AL to 3 before the down loop
DOWN_LOOP:
    DEC AL                ; Decrement AL
    CMP AL, 0x00          ; Compare to 0
    JNE DOWN_LOOP         ; Jump back if not equal
    RET                   ; Return to the main program`

function hex8(val: number): string {
  return val.toString(16).toUpperCase().padStart(2, '0')
}

function hex16(val: number): string {
  return val.toString(16).toUpperCase().padStart(4, '0')
}

// 8086 Assembly Syntax Highlighter (Studio Workstation Palette)
const FLOW_KEYWORDS = new Set([
  'JMP', 'JE', 'JZ', 'JNE', 'JNZ', 'JG', 'JNLE', 'JGE', 'JNL', 'JL', 'JNGE',
  'JLE', 'JNG', 'JA', 'JNBE', 'JAE', 'JNB', 'JB', 'JNAE', 'JBE', 'JNA',
  'JC', 'JNC', 'JO', 'JNO', 'JS', 'JNS', 'JP', 'JPE', 'JNP', 'JPO', 'JCXZ',
  'LOOP', 'LOOPE', 'LOOPZ', 'LOOPNE', 'LOOPNZ', 'CALL', 'RET', 'RETF', 'INT',
  'INTO', 'IRET', 'HLT',
])

const OP_KEYWORDS = new Set([
  'MOV', 'ADD', 'ADC', 'SUB', 'SBB', 'INC', 'DEC', 'CMP', 'MUL', 'IMUL',
  'DIV', 'IDIV', 'DAA', 'DAS', 'AAA', 'AAS', 'AAM', 'AAD', 'CBW', 'CWD',
  'NEG', 'NPG', 'AND', 'OR', 'XOR', 'NOT', 'TEST', 'SHL', 'SAL', 'SHR', 'SAR',
  'ROL', 'ROR', 'RCL', 'RCR', 'MOVS', 'MOVSB', 'MOVSW', 'CMPS', 'CMPSB', 'COMPSB', 'CMPSW', 'COMPSW', 'SCAS', 'SCASB',
  'SCASW', 'LODS', 'LODSB', 'LODSW', 'STOS', 'STOSB', 'STOSW', 'INS', 'INSB', 'INSW', 'OUTS', 'OUTSB', 'OUTSW',
  'REP', 'REPE', 'REPZ', 'REPNE', 'REPNZ', 'PUSH', 'PPUSH', 'PUSHA', 'POP', 'POPA', 'PUSHF', 'POPF', 'XCHG', 'IN', 'OUT',
  'XLAT', 'XLATB', 'LEA', 'LDS', 'LES', 'LAHF', 'SAHF', 'CLI', 'STI', 'CLC', 'STC', 'CMC', 'CLD',
  'STD', 'WAIT', 'NOP', 'LOCK',
])

const DIRECTIVES = new Set([
  'DB', 'DW', 'DD', 'DQ', 'DT', 'ORG', 'EQU', 'OFFSET', 'PTR', 'BYTE',
  'WORD', 'DWORD', 'PROC', 'ENDP', 'MACRO', 'ENDM', 'SEGMENT', 'ENDS',
  'ASSUME', 'TITLE', 'EVEN',
])

const REGISTERS = new Set([
  'AX', 'BX', 'CX', 'DX', 'AH', 'AL', 'BH', 'BL', 'CH', 'CL', 'DH', 'DL',
  'SP', 'BP', 'SI', 'DI', 'CS', 'DS', 'ES', 'SS', 'IP', 'FLAGS',
])

function highlightLine(line: string): React.ReactNode {
  if (!line) {
    return '\u00A0'
  }

  const elements: React.ReactNode[] = []
  let code = line
  let comment = ''

  const commentIdx = line.indexOf(';')
  if (commentIdx >= 0) {
    code = line.substring(0, commentIdx)
    comment = line.substring(commentIdx)
  }

  if (code) {
    const labelMatch = code.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(:)(.*)$/)
    if (labelMatch) {
      if (labelMatch[1]) {
        elements.push(<span key={`ws-${elements.length}`}>{labelMatch[1]}</span>)
      }
      elements.push(<span key={`lbl-${elements.length}`} className="syntax-label">{labelMatch[2]}</span>)
      elements.push(<span key={`col-${elements.length}`} className="syntax-operator">:</span>)
      code = labelMatch[4]
    }

    if (code) {
      const tokenRegex = /('[^']*'|"[^"]*"|0x[0-9A-Fa-f]+|[0-9][0-9A-Fa-f]*[hH]|\b[01]+[bB]\b|\b[0-9]+\b|[A-Za-z_][A-Za-z0-9_]*|[\[\],+\-*:]|\s+|[^\s\w\[\],+\-*:'"]+)/g
      const matches = code.match(tokenRegex) || [code]

      for (let i = 0; i < matches.length; i++) {
        const token = matches[i]
        const upper = token.toUpperCase()

        if (/^\s+$/.test(token)) {
          elements.push(<span key={`tok-${elements.length}`}>{token}</span>)
        } else if (/^('[^']*'|"[^"]*")$/.test(token)) {
          elements.push(<span key={`tok-${elements.length}`} className="syntax-string">{token}</span>)
        } else if (/^(0x[0-9A-Fa-f]+|[0-9][0-9A-Fa-f]*[hH]|[01]+[bB]|[0-9]+)$/i.test(token)) {
          elements.push(<span key={`tok-${elements.length}`} className="syntax-number">{token}</span>)
        } else if (FLOW_KEYWORDS.has(upper)) {
          elements.push(<span key={`tok-${elements.length}`} className="syntax-flow">{token}</span>)
        } else if (OP_KEYWORDS.has(upper)) {
          elements.push(<span key={`tok-${elements.length}`} className="syntax-keyword">{token}</span>)
        } else if (DIRECTIVES.has(upper)) {
          elements.push(<span key={`tok-${elements.length}`} className="syntax-directive">{token}</span>)
        } else if (REGISTERS.has(upper)) {
          elements.push(<span key={`tok-${elements.length}`} className="syntax-register">{token}</span>)
        } else if (/^[\[\],+\-*:]$/.test(token)) {
          elements.push(<span key={`tok-${elements.length}`} className="syntax-operator">{token}</span>)
        } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) {
          elements.push(<span key={`tok-${elements.length}`} className="syntax-label-ref">{token}</span>)
        } else {
          elements.push(<span key={`tok-${elements.length}`} className="syntax-ident">{token}</span>)
        }
      }
    }
  }

  if (comment) {
    elements.push(<span key={`cmt-${elements.length}`} className="syntax-comment">{comment}</span>)
  }

  return elements.length === 0 ? '\u00A0' : elements
}

interface SampleProgram {
  id: string
  title: string
  description: string
  code: string
}

const SAMPLE_PROGRAMS: SampleProgram[] = [
  {
    id: 'subroutines',
    title: 'Subroutines & Loops (Default)',
    description: 'Demonstrates CALL, RET, loop counting with AL register, CMP and JNE.',
    code: DEFAULT_CODE,
  },
  {
    id: 'arithmetic',
    title: 'Basic Arithmetic Operations',
    description: 'Uses MOV, ADD, SUB, INC, and DEC with AX and BX registers.',
    code: `start:
    MOV AX, 0x0005        ; Initialize AX = 5
    MOV BX, 0x0003        ; Initialize BX = 3
    ADD AX, BX            ; AX = AX + BX (5 + 3 = 8)
    SUB AX, 0x0002        ; AX = AX - 2 (8 - 2 = 6)
    INC AX                ; AX = AX + 1 (7)
    DEC BX                ; BX = BX - 1 (2)
    HLT                   ; Halt execution`,
  },
  {
    id: 'fibonacci',
    title: 'Fibonacci Series Generator',
    description: 'Computes Fibonacci numbers iteratively in AL and BL registers using CX counter.',
    code: `start:
    MOV AL, 0x00          ; First term (0)
    MOV BL, 0x01          ; Second term (1)
    MOV CX, 0x0006        ; Run 6 iterations
FIB_LOOP:
    MOV DL, AL            ; Save current AL into DL
    ADD DL, BL            ; DL = AL + BL
    MOV AL, BL            ; Shift BL to AL
    MOV BL, DL            ; Shift DL to BL (next term)
    DEC CX                ; Decrement counter
    JNZ FIB_LOOP          ; Continue while CX != 0
    HLT                   ; Halt processor`,
  },
  {
    id: 'console_io',
    title: 'Console Character Output (INT 21h)',
    description: 'Outputs characters using DOS Interrupt 21h function AH=02h.',
    code: `start:
    ; Print character 'H' (0x48)
    MOV AH, 0x02
    MOV DL, 0x48
    INT 0x21

    ; Print character 'C' (0x43)
    MOV DL, 0x43
    INT 0x21

    ; Print character 'C' (0x43)
    MOV DL, 0x43
    INT 0x21

    HLT                   ; Halt execution`,
  },
  {
    id: 'bcd_adjust',
    title: 'BCD & ASCII Adjust (AAA, DAA, AAM)',
    description: 'Demonstrates decimal arithmetic adjustments on Accumulator (8086 Arithmetic Group).',
    code: `start:
    ; 1. ASCII Adjust after Addition (AAA)
    MOV AL, 0x37          ; ASCII '7'
    MOV BL, 0x38          ; ASCII '8'
    ADD AL, BL            ; Sum: 0x6F
    AAA                   ; AH=1, AL=5 (Unpacked BCD 15)

    ; 2. ASCII Adjust after Multiplication (AAM)
    MOV AL, 0x07          ; 7
    MOV BL, 0x09          ; 9
    MUL BL                ; AL = 63 (0x3F)
    AAM                   ; AH = 6, AL = 3 (Unpacked BCD 63)

    ; 3. Decimal Adjust for Addition (DAA)
    MOV AL, 0x38          ; Packed BCD 38
    ADD AL, 0x45          ; Packed BCD 45
    DAA                   ; AL becomes BCD 83 (0x83)
    HLT`,
  },
  {
    id: 'string_transfers',
    title: 'String Data Transfer (MOVSB & LODSB)',
    description: 'Transfers sequential memory bytes using Direction Flag (CLD) and SI/DI pointers.',
    code: `start:
    CLD                   ; Clear Direction Flag (forward move)
    MOV SI, 0x0100        ; Source string offset
    MOV DI, 0x0200        ; Destination string offset
    MOV CX, 0x0004        ; Number of bytes to copy
COPY_LOOP:
    MOVSB                 ; Copy [DS:SI] to [ES:DI], auto-increment SI & DI
    LOOP COPY_LOOP        ; Decrement CX and continue while CX != 0
    HLT`,
  },
  {
    id: 'bit_manipulation',
    title: 'Bit Manipulation & Rotations (ROL, ROR, SAR)',
    description: 'Demonstrates circular bit rotation, sign-preserving arithmetic shifts, and XOR masking.',
    code: `start:
    MOV AL, 0x81          ; Binary: 1000 0001b
    ROL AL, 1             ; Rotate Left: 0000 0011b (0x03), CF=1
    ROR AL, 1             ; Rotate Right back: 1000 0001b (0x81)
    SAR AL, 1             ; Arithmetic Shift Right: preserves sign (1100 0000b = 0xC0)
    XOR AL, 0xFF          ; Invert all bits (One's complement)
    HLT`,
  },
  {
    id: 'stack_batching',
    title: 'Stack Register Batching (PUSHA, POPA, LAHF)',
    description: 'Preserves all general registers with PUSHA, captures status flags with LAHF, and restores with POPA.',
    code: `start:
    MOV AX, 0x1111
    MOV BX, 0x2222
    MOV CX, 0x3333
    MOV DX, 0x4444
    PUSHA                 ; Push AX, CX, DX, BX, SP, BP, SI, DI to stack
    LAHF                  ; Read status flags into AH register
    MOV AX, 0x9999        ; Temporarily overwrite AX
    POPA                  ; Restore all registers from stack
    HLT`,
  },
]

const FLAG_META = [
  { id: 'OF', name: 'Overflow' },
  { id: 'DF', name: 'Direction' },
  { id: 'IF', name: 'Interrupt' },
  { id: 'TF', name: 'Trap' },
  { id: 'SF', name: 'Sign' },
  { id: 'ZF', name: 'Zero' },
  { id: 'AF', name: 'Aux Carry' },
  { id: 'PF', name: 'Parity' },
  { id: 'CF', name: 'Carry' },
] as const

function App() {
  // Core Emulator State (Strictly Preserved)
  const [code, setCode] = useState(DEFAULT_CODE)
  const [cpu, setCpu] = useState<CPUState>(createInitialState())
  const [compiled, setCompiled] = useState<CompileResult | null>(null)
  const [lastCompiledCode, setLastCompiledCode] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [compileMessage, setCompileMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [inputText, setInputText] = useState('')
  const [outputText, setOutputText] = useState('')
  const [memoryStart, setMemoryStartState] = useState('00000')
  const [memoryStartAddr, setMemoryStartAddr] = useState(0)
  const [prevCpu, setPrevCpu] = useState<CPUState | null>(null)
  const [currentLine, setCurrentLine] = useState<number | null>(null)
  const [speed, setSpeed] = useState(200)

  // Layout presentation states (Modular 3-Panel)
  const [showLeftPanel, setShowLeftPanel] = useState(true)
  const [showRightPanel, setShowRightPanel] = useState(true)
  const [consoleTab, setConsoleTab] = useState<'terminal' | 'disasm' | 'diagnostics'>('terminal')

  // Academic metadata
  const section = 'BSCS-3A'
  const batchYear = '2026'

  // Modals
  const [showInfoModal, setShowInfoModal] = useState(false)
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [showExamplesModal, setShowExamplesModal] = useState(false)
  const [insActiveCategory, setInsActiveCategory] = useState<number>(0)
  const [insSearch, setInsSearch] = useState<string>('')

  const filteredInstructions = useMemo(() => {
    return INSTRUCTION_DATABASE.filter((inst) => {
      const matchesCat = insActiveCategory === 0 || inst.category === insActiveCategory
      if (!matchesCat) return false
      if (!insSearch) return true
      const q = insSearch.toLowerCase()
      return (
        inst.mnemonic.toLowerCase().includes(q) ||
        inst.syntax.toLowerCase().includes(q) ||
        inst.description.toLowerCase().includes(q) ||
        inst.categoryName.toLowerCase().includes(q) ||
        (inst.flagsAffected && inst.flagsAffected.toLowerCase().includes(q))
      )
    })
  }, [insActiveCategory, insSearch])

  const runIntervalRef = useRef<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lineNumbersRef = useRef<HTMLDivElement>(null)
  const highlightLayerRef = useRef<HTMLDivElement>(null)
  const outputRef = useRef<string>('')
  const inputBufferRef = useRef<string>('')

  const lines = code.split('\n')

  // Sync scroll
  const handleScroll = useCallback(() => {
    if (textareaRef.current) {
      const top = textareaRef.current.scrollTop
      const left = textareaRef.current.scrollLeft
      if (lineNumbersRef.current) {
        lineNumbersRef.current.scrollTop = top
      }
      if (highlightLayerRef.current) {
        highlightLayerRef.current.scrollTop = top
        highlightLayerRef.current.scrollLeft = left
      }
    }
  }, [])

  useEffect(() => {
    if (textareaRef.current && highlightLayerRef.current) {
      highlightLayerRef.current.scrollTop = textareaRef.current.scrollTop
      highlightLayerRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }, [code])

  const stopRunning = useCallback(() => {
    setIsRunning(false)
    if (runIntervalRef.current) {
      clearInterval(runIntervalRef.current)
      runIntervalRef.current = null
    }
  }, [])

  const handleInsertInstruction = useCallback((snippet: string) => {
    setCode(prev => {
      const trimmed = prev.trimEnd()
      return trimmed + (trimmed.length > 0 ? '\n' : '') + snippet + '\n'
    })
    setLastCompiledCode(null)
    stopRunning()
    setShowHelpModal(false)
  }, [stopRunning])

  // Handle Tab key indent
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const start = e.currentTarget.selectionStart
      const end = e.currentTarget.selectionEnd
      const newCode = code.substring(0, start) + '    ' + code.substring(end)
      setCode(newCode)
      setCurrentLine(null)
      stopRunning()
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 4
        }
      })
    }
  }, [code, stopRunning])

  // Compile Handler
  const handleCompile = useCallback(() => {
    stopRunning()
    const result = compile(code)
    setCompiled(result)

    if (result.errors.length > 0) {
      setLastCompiledCode(null)
      setCompileMessage({ text: `Compilation failed: ${result.errors.join(', ')}`, type: 'error' })
      setConsoleTab('diagnostics')
    } else {
      setLastCompiledCode(code)
      setCompileMessage({ text: `Compilation successful! ${result.instructions.length} instructions assembled. Ready to run.`, type: 'success' })
      const newCpu = createInitialState()
      if (result.instructions.length > 0) {
        const startAddr = result.labels.get('START') ?? result.instructions[0].address
        newCpu.IP = startAddr
        newCpu.SP = 0xFFFE
        newCpu.SS = 0x0000
      }
      setCpu(newCpu)
      setPrevCpu(null)
      setOutputText('')
      outputRef.current = ''
      setCurrentLine(result.instructions.find(i => i.address === newCpu.IP)?.lineNumber ?? null)
    }
  }, [code, stopRunning])

  // Execute single step
  const executeStep = useCallback(() => {
    if (!compiled || cpu.halted) return false

    setPrevCpu({ ...cpu, memory: new Uint8Array(cpu.memory) })
    const newCpu: CPUState = {
      ...cpu,
      memory: new Uint8Array(cpu.memory),
    }

    const { inputConsumed } = executeInstruction(
      newCpu,
      compiled.instructions,
      compiled.labels,
      inputBufferRef.current,
      (char: string) => {
        outputRef.current += char
        setOutputText(outputRef.current)
      }
    )

    if (inputConsumed > 0) {
      inputBufferRef.current = inputBufferRef.current.substring(inputConsumed)
    }

    setCpu(newCpu)
    const nextInst = compiled.instructions.find(i => i.address === newCpu.IP)
    setCurrentLine(nextInst?.lineNumber ?? null)

    if (newCpu.halted) {
      if (newCpu.error) {
        setCompileMessage({ text: `Runtime error: ${newCpu.error}`, type: 'error' })
      } else {
        setCompileMessage({ text: 'Program halted. Click Re-run (F5) to execute again.', type: 'success' })
      }
      setIsRunning(false)
      return false
    }
    return true
  }, [compiled, cpu])

  const handleNext = useCallback(() => {
    const isCodeModified = lastCompiledCode === null || code !== lastCompiledCode
    if (!compiled || compiled.errors.length > 0 || isCodeModified) {
      setCompileMessage({
        text: isCodeModified && lastCompiledCode !== null
          ? 'Code has been edited. Please compile (F7) before stepping.'
          : 'Please compile the code first before stepping.',
        type: 'error',
      })
      setConsoleTab('diagnostics')
      return
    }
    if (cpu.halted) {
      // Re-initialize CPU state to entry point and ready for stepping
      const newCpu = createInitialState()
      if (compiled.instructions.length > 0) {
        const startAddr = compiled.labels.get('START') ?? compiled.instructions[0].address
        newCpu.IP = startAddr
        newCpu.SP = 0xFFFE
        newCpu.SS = 0x0000
        setCurrentLine(compiled.instructions.find(i => i.address === newCpu.IP)?.lineNumber ?? null)
      }
      setCpu(newCpu)
      setPrevCpu(null)
      setOutputText('')
      outputRef.current = ''
      setCompileMessage({ text: 'Restarted at entry point.', type: 'success' })
      return
    }
    executeStep()
  }, [compiled, cpu.halted, code, lastCompiledCode, executeStep])

  const handleRun = useCallback(() => {
    const isCodeModified = lastCompiledCode === null || code !== lastCompiledCode
    if (!compiled || compiled.errors.length > 0 || isCodeModified) {
      setCompileMessage({
        text: isCodeModified && lastCompiledCode !== null
          ? 'Code has been edited. Please compile (F7) before running.'
          : 'Please compile the code first before running.',
        type: 'error',
      })
      setConsoleTab('diagnostics')
      return
    }
    if (cpu.halted) {
      // Re-run compiled code from entry point automatically without needing re-compilation
      const newCpu = createInitialState()
      if (compiled.instructions.length > 0) {
        const startAddr = compiled.labels.get('START') ?? compiled.instructions[0].address
        newCpu.IP = startAddr
        newCpu.SP = 0xFFFE
        newCpu.SS = 0x0000
        setCurrentLine(compiled.instructions.find(i => i.address === newCpu.IP)?.lineNumber ?? null)
      }
      setCpu(newCpu)
      setPrevCpu(null)
      setOutputText('')
      outputRef.current = ''
      setCompileMessage({ text: 'Re-running compiled program...', type: 'success' })
      setIsRunning(true)
      return
    }
    setIsRunning(true)
  }, [compiled, cpu.halted, code, lastCompiledCode])

  const handleResetCpu = useCallback(() => {
    stopRunning()
    const newCpu = createInitialState()
    if (compiled && compiled.instructions.length > 0) {
      const startAddr = compiled.labels.get('START') ?? compiled.instructions[0].address
      newCpu.IP = startAddr
      newCpu.SP = 0xFFFE
      newCpu.SS = 0x0000
      setCurrentLine(compiled.instructions.find(i => i.address === newCpu.IP)?.lineNumber ?? null)
    } else {
      setCurrentLine(null)
    }
    setCpu(newCpu)
    setPrevCpu(null)
    setOutputText('')
    outputRef.current = ''
    setCompileMessage(null)
  }, [compiled, stopRunning])

  // Continuous loop
  useEffect(() => {
    if (isRunning && compiled && !cpu.halted) {
      runIntervalRef.current = window.setInterval(() => {
        setCpu(prevState => {
          const newCpu: CPUState = {
            ...prevState,
            memory: new Uint8Array(prevState.memory),
          }

          const { inputConsumed } = executeInstruction(
            newCpu,
            compiled.instructions,
            compiled.labels,
            inputBufferRef.current,
            (char: string) => {
              outputRef.current += char
              setOutputText(outputRef.current)
            }
          )

          if (inputConsumed > 0) {
            inputBufferRef.current = inputBufferRef.current.substring(inputConsumed)
          }

          const nextInst = compiled.instructions.find(i => i.address === newCpu.IP)
          setCurrentLine(nextInst?.lineNumber ?? null)

          if (newCpu.halted) {
            if (newCpu.error) {
              setCompileMessage({ text: `Runtime error: ${newCpu.error}`, type: 'error' })
            } else {
              setCompileMessage({ text: 'Program halted. Click Re-run (F5) to execute again.', type: 'success' })
            }
            setIsRunning(false)
          }

          return newCpu
        })
      }, speed)

      return () => {
        if (runIntervalRef.current) {
          clearInterval(runIntervalRef.current)
          runIntervalRef.current = null
        }
      }
    }
  }, [isRunning, compiled, speed, cpu.halted])

  // Set memory start address
  const handleSetMemoryAddr = useCallback(() => {
    const addr = parseInt(memoryStart, 16)
    if (!isNaN(addr)) {
      setMemoryStartAddr(addr & 0xFFFF)
    }
  }, [memoryStart])

  const jumpToAddr = useCallback((addr: number) => {
    const clamped = addr & 0xFFFF
    setMemoryStartAddr(clamped)
    setMemoryStartState(hex16(clamped))
  }, [])

  // Input submission
  const handleInputSubmit = useCallback(() => {
    inputBufferRef.current += inputText
    setInputText('')
  }, [inputText])

  // Register change check
  const didChange = (reg: string): boolean => {
    if (!prevCpu) return false
    return (cpu as any)[reg] !== (prevCpu as any)[reg]
  }

  // Workstation Shortcuts: F7 (compile), F5 (run), F10 (step), Esc (stop)
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if (e.key === 'F7') {
        e.preventDefault()
        handleCompile()
      } else if (e.key === 'F5') {
        e.preventDefault()
        handleRun()
      } else if (e.key === 'F10') {
        e.preventDefault()
        handleNext()
      } else if (e.key === 'Escape') {
        if (isRunning) {
          e.preventDefault()
          stopRunning()
        }
      }
    }
    window.addEventListener('keydown', handleGlobalKey)
    return () => window.removeEventListener('keydown', handleGlobalKey)
  }, [handleCompile, handleRun, handleNext, isRunning, stopRunning])

  // Render Memory Grid with ASCII decode
  const renderMemoryGrid = () => {
    const rows = []
    const bytesPerRow = 16
    const numRows = 8

    for (let row = 0; row < numRows; row++) {
      const baseAddr = (memoryStartAddr + row * bytesPerRow) & 0xFFFF
      const byteCells = []
      let asciiStr = ''

      for (let col = 0; col < bytesPerRow; col++) {
        const addr = (baseAddr + col) & 0xFFFF
        const val = cpu.memory[addr]
        const changed = prevCpu && prevCpu.memory[addr] !== val

        if (val >= 32 && val <= 126) {
          asciiStr += String.fromCharCode(val)
        } else {
          asciiStr += '.'
        }

        byteCells.push(
          <span
            key={col}
            className={`ws-hex-cell ${changed ? 'changed' : val > 0 ? 'nonzero' : ''}`}
            title={`Offset 0x${hex16(addr)}: ${val} (0x${hex8(val)})`}
          >
            {hex8(val)}
          </span>
        )
      }

      rows.push(
        <div key={row} className="ws-hex-data-row">
          <span className="ws-hex-base-addr">{hex16(baseAddr)}</span>
          {byteCells}
          <div className="ws-hex-sep" />
          <span className="ws-ascii-decoded">{asciiStr}</span>
        </div>
      )
    }

    return rows
  }

  const generalRegs = [
    { name: 'AX', high: 'AH', low: 'AL', desc: 'Accumulator' },
    { name: 'BX', high: 'BH', low: 'BL', desc: 'Base Register' },
    { name: 'CX', high: 'CH', low: 'CL', desc: 'Count Register' },
    { name: 'DX', high: 'DH', low: 'DL', desc: 'Data Register' },
  ]

  const pointerRegs = [
    { name: 'SP', desc: 'Stack Pointer' },
    { name: 'BP', desc: 'Base Pointer' },
    { name: 'SI', desc: 'Source Index' },
    { name: 'DI', desc: 'Destination Index' },
    { name: 'IP', desc: 'Instruction Pointer' },
  ] as const

  const segmentRegs = [
    { name: 'CS', desc: 'Code Segment' },
    { name: 'DS', desc: 'Data Segment' },
    { name: 'SS', desc: 'Stack Segment' },
    { name: 'ES', desc: 'Extra Segment' },
  ] as const

  const isCodeModified = lastCompiledCode === null || code !== lastCompiledCode
  const isCompiledReady = compiled !== null && compiled.errors.length === 0 && !isCodeModified

  const currentStatusText = cpu.error
    ? 'ERROR'
    : isRunning
      ? 'RUNNING'
      : isCodeModified
        ? lastCompiledCode !== null
          ? 'CODE MODIFIED'
          : 'NEEDS COMPILE'
        : cpu.halted
          ? 'HALTED (READY)'
          : isCompiledReady
            ? 'READY'
            : 'NEEDS COMPILE'

  const currentStatusClass = cpu.error
    ? 'error'
    : isRunning
      ? 'running'
      : isCodeModified
        ? 'standby'
        : cpu.halted
          ? 'ready'
          : isCompiledReady
            ? 'ready'
            : 'standby'

  return (
    <>
      {/* ===================================================================
          1. TOP ENGINEERING WORKSTATION BAR
          =================================================================== */}
      <header className="ws-topbar">
        <div className="ws-brand-group">
          <div className="ws-chip-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="4" y="4" width="16" height="16" rx="2" />
              <rect x="9" y="9" width="6" height="6" />
              <line x1="9" y1="1" x2="9" y2="4" />
              <line x1="15" y1="1" x2="15" y2="4" />
              <line x1="9" y1="20" x2="9" y2="23" />
              <line x1="15" y1="20" x2="15" y2="23" />
              <line x1="1" y1="9" x2="4" y2="9" />
              <line x1="1" y1="15" x2="4" y2="15" />
              <line x1="20" y1="9" x2="23" y2="9" />
              <line x1="20" y1="15" x2="23" y2="15" />
            </svg>
          </div>
          <div className="ws-brand-info">
            <span className="ws-brand-title">HEXBYTE8086</span>
            <span className="ws-brand-sub">ARCH &amp; ORG • SILICON INSIDE</span>
          </div>
          <span className="ws-pill">x86-16 Real Mode</span>
        </div>

        {/* Center Execution Controls Deck */}
        <div className="ws-toolbar">
          <div className="ws-deck">
            <button
              className={`ws-action-btn btn-compile ${!isCompiledReady ? 'pulse-needed' : ''}`}
              onClick={handleCompile}
              title="Compile & Assemble (F7)"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
              </svg>
              Compile
            </button>

            <button
              className={`ws-action-btn btn-run ${!isCompiledReady || isRunning ? 'disabled' : ''}`}
              onClick={handleRun}
              disabled={!isCompiledReady || isRunning}
              title={
                !isCompiledReady
                  ? isCodeModified && lastCompiledCode !== null
                    ? "Code was edited: Compile (F7) before running"
                    : "Compile code first before running"
                  : cpu.halted
                    ? "Re-run Program from Start (F5)"
                    : "Run Program (F5)"
              }
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              {cpu.halted && isCompiledReady ? 'Re-run' : 'Run'}
            </button>

            <button
              className={`ws-action-btn btn-step ${!isCompiledReady || isRunning ? 'disabled' : ''}`}
              onClick={handleNext}
              disabled={!isCompiledReady || isRunning}
              title={
                !isCompiledReady
                  ? isCodeModified && lastCompiledCode !== null
                    ? "Code was edited: Compile (F7) before stepping"
                    : "Compile code first before stepping"
                  : cpu.halted
                    ? "Restart & Step from Start (F10)"
                    : "Single Instruction Step (F10)"
              }
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
                <line x1="19" y1="6" x2="19" y2="18" />
              </svg>
              Step
            </button>

            <button
              className={`ws-action-btn btn-stop ${!isRunning ? 'disabled' : ''}`}
              onClick={stopRunning}
              disabled={!isRunning}
              title="Halt / Pause Execution (Esc)"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
              Stop
            </button>

            <button
              className="ws-action-btn btn-reset"
              onClick={handleResetCpu}
              title="Reset Processor State"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              Reset
            </button>

            <div className="ws-divider" />

            <div className="ws-rate-box" title="Clock Cycle Rate">
              <span className="ws-rate-label">Rate</span>
              <input
                type="range"
                className="ws-rate-slider"
                min="10"
                max="1000"
                value={1010 - speed}
                onChange={(e) => setSpeed(1010 - parseInt(e.target.value))}
              />
              <span className="ws-rate-val">{speed}ms</span>
            </div>
          </div>
        </div>

        {/* Right Panel Toggles & Modals */}
        <div className="ws-topbar-right">
          <button
            className={`ws-panel-toggle-btn ${showLeftPanel ? 'active' : ''}`}
            onClick={() => setShowLeftPanel(!showLeftPanel)}
            title="Toggle CPU Registers Panel"
          >
            <span>CPU</span>
          </button>

          <button
            className={`ws-panel-toggle-btn ${showRightPanel ? 'active' : ''}`}
            onClick={() => setShowRightPanel(!showRightPanel)}
            title="Toggle Memory Space Panel"
          >
            <span>Memory</span>
          </button>

          <div className="ws-divider" />

          <button
            className="ws-tool-icon-btn"
            onClick={() => setShowExamplesModal(true)}
            title="Load Sample Assembly Programs"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
          </button>

          <button
            className="ws-tool-icon-btn with-label"
            style={{ width: 'auto', padding: '0 9px', gap: '5px' }}
            onClick={() => setShowHelpModal(true)}
            title="8086 Instruction Sets & Curriculum Guide (8 Categories)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c084fc" strokeWidth="2">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)' }}>Instruction Sets</span>
          </button>

          <button
            className="ws-tool-icon-btn"
            onClick={() => setShowInfoModal(true)}
            title="Academic Dossier & Project Info"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </button>
        </div>
      </header>

      {/* ===================================================================
          2. WORKSPACE: REIMAGINED 3-PANEL SILICON LAYOUT
          LEFT = CPU Registers & Flags
          CENTER = Code Editor & Tabbed Terminal Workspace
          RIGHT = 64KB Hex Memory Space & ASCII Decoder
          =================================================================== */}
      <main className="ws-workspace">
        {/* PANEL 1 (LEFT): CPU ARCHITECTURE & REGISTERS */}
        {showLeftPanel && (
          <aside className="ws-left-panel">
            <div className="ws-panel-titlebar">
              <span className="ws-panel-title">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
                Processor State
              </span>
              <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
                IP: <strong style={{ color: 'var(--accent-amber)' }}>0x{hex16(cpu.IP)}</strong>
              </span>
            </div>

            {/* General Purpose Registers */}
            <div className="ws-section-block">
              <div className="ws-block-head">
                <span>General Purpose Registers</span>
                <span style={{ fontSize: '9px', color: 'var(--text-dim)' }}>Hi | Lo | 16-bit</span>
              </div>
              <div className="ws-reg-grid">
                {generalRegs.map((reg) => {
                  const regName = reg.name as 'AX' | 'BX' | 'CX' | 'DX'
                  const char = reg.name[0]
                  const hiVal = getRegisterH(cpu, char)
                  const loVal = getRegisterL(cpu, char)
                  const full16 = cpu[regName]
                  const changed = didChange(regName)

                  return (
                    <div key={reg.name} className="ws-reg-card">
                      <span className="ws-reg-card-name" title={reg.desc}>{reg.name}</span>
                      <div className="ws-reg-card-byte">
                        <span className="ws-byte-lbl">{reg.high}</span>
                        <span className={`ws-byte-val ${changed ? 'changed' : ''}`}>{hex8(hiVal)}</span>
                      </div>
                      <div className="ws-reg-card-byte">
                        <span className="ws-byte-lbl">{reg.low}</span>
                        <span className={`ws-byte-val ${changed ? 'changed' : ''}`}>{hex8(loVal)}</span>
                      </div>
                      <div className="ws-reg-card-word">
                        <span className={`ws-word-hex ${changed ? 'changed' : ''}`}>0x{hex16(full16)}</span>
                        <span className="ws-word-dec">{full16}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Segment & Pointer Registers */}
            <div className="ws-section-block">
              <div className="ws-two-col">
                {/* Segments */}
                <div>
                  <div className="ws-block-head" style={{ marginBottom: '4px' }}>Segments</div>
                  <div className="ws-mini-list">
                    {segmentRegs.map((seg) => {
                      const changed = didChange(seg.name)
                      return (
                        <div key={seg.name} className="ws-mini-item">
                          <span className="ws-mini-tag" title={seg.desc}>{seg.name}</span>
                          <span className={`ws-mini-val ${changed ? 'changed' : ''}`}>
                            {hex16(cpu[seg.name])}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Pointers */}
                <div>
                  <div className="ws-block-head" style={{ marginBottom: '4px' }}>Pointers</div>
                  <div className="ws-mini-list">
                    {pointerRegs.map((ptr) => {
                      const changed = didChange(ptr.name)
                      return (
                        <div key={ptr.name} className="ws-mini-item">
                          <span className="ws-mini-tag ptr" title={ptr.desc}>{ptr.name}</span>
                          <span className={`ws-mini-val ${changed ? 'changed' : ''}`}>
                            {hex16(cpu[ptr.name])}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Flags Register */}
            <div className="ws-section-block" style={{ borderBottom: 'none' }}>
              <div className="ws-block-head">
                <span>CPU Flags Register</span>
                <span style={{ fontSize: '9px', color: 'var(--text-dim)' }}>Status Bits</span>
              </div>
              <div className="ws-flag-matrix">
                {FLAG_META.map((flag) => {
                  const isSet = cpu[flag.id] === 1
                  return (
                    <div
                      key={flag.id}
                      className={`ws-flag-box ${isSet ? 'active' : ''}`}
                      title={`${flag.name} Flag (${flag.id}): ${isSet ? 'Set (1)' : 'Clear (0)'}`}
                    >
                      <span className="ws-flag-id">{flag.id}</span>
                      <span className="ws-flag-num">{cpu[flag.id]}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </aside>
        )}

        {/* PANEL 2 (CENTER): CODE EDITOR & LOWER DOCKED TERMINAL */}
        <section className="ws-center-panel">
          {/* File Header Bar */}
          <div className="ws-editor-tabbar">
            <div className="ws-active-file">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span>program.asm</span>
            </div>

            <div className="ws-file-stats">
              <span className="ws-pill">{lines.length} lines</span>
              {isCompiledReady ? (
                <span className="ws-pill" style={{ color: 'var(--accent-emerald)', borderColor: 'rgba(16, 185, 129, 0.3)' }}>
                  ✓ {compiled?.instructions.length} inst
                </span>
              ) : isCodeModified && lastCompiledCode !== null ? (
                <span className="ws-pill" style={{ color: 'var(--accent-amber)', borderColor: 'rgba(251, 191, 36, 0.3)' }} title="Code edited since last compilation. Press Compile (F7)">
                  ⚠️ Code Modified (Compile Required)
                </span>
              ) : (
                <span className="ws-pill" style={{ color: 'var(--accent-amber)', borderColor: 'rgba(251, 191, 36, 0.3)' }}>
                  ⚠️ Needs Compile
                </span>
              )}
              {currentLine !== null && (
                <span className="ws-pill" style={{ color: '#c084fc' }}>
                  Active Line: {currentLine}
                </span>
              )}
            </div>
          </div>

          {/* Editor Core */}
          <div className="ws-editor-body">
            <div className="ws-line-gutter" ref={lineNumbersRef}>
              {lines.map((_, i) => (
                <div
                  key={i}
                  className={`ws-gutter-item ${currentLine === i + 1 ? 'active' : ''}`}
                >
                  {i + 1}
                </div>
              ))}
            </div>

            <div className="ws-editor-wrap">
              <div className="ws-syntax-view" ref={highlightLayerRef} aria-hidden="true">
                {lines.map((line, i) => (
                  <div
                    key={i}
                    className={`ws-code-row ${currentLine === i + 1 ? 'active-exec' : ''}`}
                  >
                    {highlightLine(line)}
                  </div>
                ))}
              </div>
              <textarea
                ref={textareaRef}
                className="ws-editor-input"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value)
                  setCurrentLine(null)
                  stopRunning()
                }}
                onScroll={handleScroll}
                onKeyDown={handleKeyDown}
                spellCheck={false}
                placeholder="Enter 8086 Assembly code here..."
              />
            </div>
          </div>

          {/* LOWER DOCKED CONSOLE */}
          <div className="ws-bottom-console">
            <div className="ws-console-tabbar">
              <div className="ws-tab-pills">
                <button
                  className={`ws-console-pill ${consoleTab === 'terminal' ? 'active' : ''}`}
                  onClick={() => setConsoleTab('terminal')}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="4 17 10 11 4 5" />
                    <line x1="12" y1="19" x2="20" y2="19" />
                  </svg>
                  Console I/O
                </button>
                <button
                  className={`ws-console-pill ${consoleTab === 'disasm' ? 'active' : ''}`}
                  onClick={() => setConsoleTab('disasm')}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="4" y1="6" x2="20" y2="6" />
                    <line x1="4" y1="12" x2="14" y2="12" />
                    <line x1="4" y1="18" x2="18" y2="18" />
                  </svg>
                  Disassembly Trace {compiled ? `(${compiled.instructions.length})` : ''}
                </button>
                <button
                  className={`ws-console-pill ${consoleTab === 'diagnostics' ? 'active' : ''}`}
                  onClick={() => setConsoleTab('diagnostics')}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  Diagnostics
                </button>
              </div>

              {consoleTab === 'terminal' && outputText && (
                <button
                  className="ws-term-send-btn"
                  onClick={() => {
                    outputRef.current = ''
                    setOutputText('')
                  }}
                  title="Clear Terminal Output Stream"
                >
                  Clear Output
                </button>
              )}
            </div>

            <div className="ws-console-stage">
              {consoleTab === 'terminal' && (
                <>
                  <div className="ws-terminal-body">
                    {outputText ? (
                      <div className="ws-term-stream">{outputText}</div>
                    ) : (
                      <div className="ws-term-placeholder">
                        Standard I/O stream ready. INT 21h console character outputs will print here.
                      </div>
                    )}
                  </div>
                  <div className="ws-terminal-input-row">
                    <span className="ws-term-prompt">&gt;_</span>
                    <input
                      className="ws-term-input-field"
                      type="text"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleInputSubmit()}
                      placeholder="Type character input for INT 21h (AH=01h) and press Enter..."
                    />
                    <button
                      className="ws-term-send-btn"
                      onClick={handleInputSubmit}
                      title="Send Input Buffer"
                    >
                      Send [⏎]
                    </button>
                  </div>
                </>
              )}

              {consoleTab === 'disasm' && (
                <div style={{ padding: '0', overflowY: 'auto', flex: 1 }}>
                  {compiled && compiled.instructions.length > 0 ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: '11.5px' }}>
                      <thead>
                        <tr style={{ background: 'var(--bg-card)', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-subtle)', textAlign: 'left' }}>
                          <th style={{ width: '36px', padding: '4px 8px' }}>Ptr</th>
                          <th style={{ width: '70px', padding: '4px 8px' }}>Offset</th>
                          <th style={{ width: '80px', padding: '4px 8px' }}>Mnemonic</th>
                          <th style={{ padding: '4px 8px' }}>Operands</th>
                          <th style={{ width: '50px', padding: '4px 8px' }}>Line</th>
                        </tr>
                      </thead>
                      <tbody>
                        {compiled.instructions.map((inst, idx) => {
                          const isCurrent = cpu.IP === inst.address
                          return (
                            <tr
                              key={idx}
                              style={{
                                background: isCurrent ? 'rgba(245, 158, 11, 0.14)' : 'transparent',
                                borderBottom: '1px solid rgba(255, 255, 255, 0.02)',
                                color: isCurrent ? 'var(--text-primary)' : 'var(--text-secondary)',
                                fontWeight: isCurrent ? 700 : 400,
                              }}
                            >
                              <td style={{ padding: '3px 8px', color: 'var(--accent-amber)' }}>{isCurrent ? '▶' : ''}</td>
                              <td style={{ padding: '3px 8px' }}>0x{hex16(inst.address)}</td>
                              <td style={{ padding: '3px 8px', color: '#60a5fa', fontWeight: 600 }}>{inst.mnemonic}</td>
                              <td style={{ padding: '3px 8px' }}>{inst.operands.join(', ') || '-'}</td>
                              <td style={{ padding: '3px 8px', color: 'var(--text-dim)' }}>:{inst.lineNumber}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ padding: '14px', color: 'var(--text-dim)', fontStyle: 'italic' }}>
                      No assembled instructions. Click "Compile" to generate disassembly stream.
                    </div>
                  )}
                </div>
              )}

              {consoleTab === 'diagnostics' && (
                <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {compileMessage ? (
                    <div
                      style={{
                        padding: '5px 10px',
                        borderRadius: 'var(--radius-xs)',
                        fontSize: '11px',
                        fontWeight: 600,
                        background: compileMessage.type === 'success' ? 'var(--accent-emerald-subtle)' : 'var(--accent-rose-subtle)',
                        border: `1px solid ${compileMessage.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'}`,
                        color: compileMessage.type === 'success' ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                        width: 'fit-content',
                      }}
                    >
                      {compileMessage.type === 'success' ? '✓' : '✗'} {compileMessage.text}
                    </div>
                  ) : (
                    <div style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>
                      Ready. No compile diagnostic events logged.
                    </div>
                  )}

                  {compiled && compiled.labels.size > 0 && (
                    <div style={{ marginTop: '4px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginBottom: '4px', textTransform: 'uppercase', fontWeight: 700 }}>
                        Resolved Symbol / Label Table:
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {Array.from(compiled.labels.entries()).map(([lbl, addr]) => (
                          <span
                            key={lbl}
                            className="ws-pill"
                            style={{ fontFamily: 'var(--font-mono)' }}
                          >
                            <span style={{ color: 'var(--accent-rose)' }}>{lbl}</span>: 0x{hex16(addr)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* PANEL 3 (RIGHT): 64KB MEMORY INSPECTOR & ASCII DECODER */}
        {showRightPanel && (
          <aside className="ws-right-panel">
            <div className="ws-panel-titlebar">
              <span className="ws-panel-title">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" strokeWidth="2">
                  <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                  <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                  <line x1="6" y1="6" x2="6.01" y2="6" />
                  <line x1="6" y1="18" x2="6.01" y2="18" />
                </svg>
                Memory Space (64KB)
              </span>
              <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
                Hex + ASCII
              </span>
            </div>

            <div className="ws-mem-nav-bar">
              <div className="ws-mem-search-field">
                <span style={{ fontSize: '10.5px', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
                  Offset: 0x
                </span>
                <input
                  className="ws-mem-addr-input"
                  type="text"
                  value={memoryStart}
                  onChange={(e) => setMemoryStartState(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSetMemoryAddr()}
                  maxLength={5}
                  placeholder="0000"
                />
                <button className="ws-jump-btn" onClick={handleSetMemoryAddr} style={{ fontWeight: 600 }}>
                  Go
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                <span style={{ fontSize: '9px', color: 'var(--text-dim)' }}>Jump:</span>
                <button className="ws-jump-btn" onClick={() => jumpToAddr(0)}>
                  0000h
                </button>
                <button className="ws-jump-btn" onClick={() => jumpToAddr(cpu.IP)}>
                  IP
                </button>
                <button className="ws-jump-btn" onClick={() => jumpToAddr(cpu.SP - 16)}>
                  SP
                </button>
              </div>
            </div>

            <div className="ws-hex-grid-wrap">
              <div className="ws-hex-head-row">
                <span>ADDR</span>
                <span>00</span><span>01</span><span>02</span><span>03</span>
                <span>04</span><span>05</span><span>06</span><span>07</span>
                <span>08</span><span>09</span><span>0A</span><span>0B</span>
                <span>0C</span><span>0D</span><span>0E</span><span>0F</span>
                <span />
                <span>ASCII DUMP</span>
              </div>
              {renderMemoryGrid()}
            </div>
          </aside>
        )}
      </main>

      {/* ===================================================================
          3. BOTTOM UNIFIED STATUS & ACADEMIC BAR
          =================================================================== */}
      <footer className="ws-bottom-bar">
        <div className="ws-bar-left">
          <div className="ws-state-diode">
            <span className={`ws-led-dot ${currentStatusClass}`} />
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{currentStatusText}</span>
          </div>

          <span style={{ color: 'var(--border-default)' }}>|</span>

          <span>IP: <strong style={{ color: 'var(--accent-amber)', fontFamily: 'var(--font-mono)' }}>0x{hex16(cpu.IP)}</strong></span>
          <span>SP: <strong style={{ color: '#c084fc', fontFamily: 'var(--font-mono)' }}>0x{hex16(cpu.SP)}</strong></span>
          <span>SS: <strong style={{ color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>0x{hex16(cpu.SS)}</strong></span>
        </div>

        <div className="ws-bar-mid">
          <div className="ws-college-tag">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
              <path d="M6 12v5c3 3 9 3 12 0v-5" />
            </svg>
            <span>Holy Cross College</span>
          </div>

          <span className="ws-scite-pill">SCITE</span>
          <span style={{ fontSize: '10.5px', color: 'var(--text-tertiary)' }}>
            Architecture and Organization • BSCS
          </span>

          <span style={{ color: 'var(--border-default)' }}>•</span>

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ fontSize: '10.5px', color: 'var(--text-tertiary)' }}>Section:</span>
            <span className="ws-section-badge">{section}</span>
          </div>

          <span style={{ color: 'var(--border-default)' }}>•</span>

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ fontSize: '10.5px', color: 'var(--text-tertiary)' }}>Batch Year:</span>
            <span className="ws-section-badge">{batchYear}</span>
          </div>
        </div>

        <div className="ws-bar-right">
          <div className="ws-project-badge">
            <span>★</span>
            <span>FINAL PROJECT</span>
          </div>

          <button
            className="ws-tool-icon-btn"
            style={{ width: '22px', height: '22px', fontSize: '10px' }}
            onClick={() => setShowInfoModal(true)}
            title="View Full Academic Dossier"
          >
            i
          </button>
        </div>
      </footer>

      {/* ===================================================================
          4. MODALS & DIALOGS
          =================================================================== */}

      {/* Academic Project Info Modal */}
      {showInfoModal && (
        <div className="ws-modal-overlay" onClick={() => setShowInfoModal(false)}>
          <div className="ws-modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="ws-modal-head">
              <div className="ws-modal-heading">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
                  <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
                  <path d="M6 12v5c3 3 9 3 12 0v-5" />
                </svg>
                <span>Academic Dossier &amp; Project Specifications</span>
              </div>
              <button className="ws-modal-x" onClick={() => setShowInfoModal(false)}>✕</button>
            </div>

            <div className="ws-modal-content-area">
              <div className="ws-dossier-card">
                <div className="ws-dossier-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    <polyline points="9 22 9 12 15 12 15 22" />
                  </svg>
                  Institution &amp; Department
                </div>
                <div className="ws-dossier-grid">
                  <div className="ws-dossier-field">
                    <span className="ws-dossier-lbl">College / University</span>
                    <span className="ws-dossier-val" style={{ color: 'var(--accent-blue)' }}>
                      Holy Cross College
                    </span>
                  </div>
                  <div className="ws-dossier-field">
                    <span className="ws-dossier-lbl">Academic Department</span>
                    <span className="ws-dossier-val">
                      SCITE — School of Computing, Information Technology, and Engineering
                    </span>
                  </div>
                </div>
              </div>

              <div className="ws-dossier-card">
                <div className="ws-dossier-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </svg>
                  Curricular Information
                </div>
                <div className="ws-dossier-grid">
                  <div className="ws-dossier-field">
                    <span className="ws-dossier-lbl">Subject</span>
                    <span className="ws-dossier-val" style={{ color: 'var(--accent-amber)' }}>
                      Architecture and Organization
                    </span>
                  </div>
                  <div className="ws-dossier-field">
                    <span className="ws-dossier-lbl">Degree Program</span>
                    <span className="ws-dossier-val">
                      Bachelor of Science in Computer Science
                    </span>
                  </div>
                  <div className="ws-dossier-field">
                    <span className="ws-dossier-lbl">Section</span>
                    <span className="ws-dossier-val" style={{ color: 'var(--accent-amber)' }}>
                      {section}
                    </span>
                  </div>
                  <div className="ws-dossier-field">
                    <span className="ws-dossier-lbl">Batch Year</span>
                    <span className="ws-dossier-val" style={{ color: 'var(--accent-amber)' }}>
                      {batchYear}
                    </span>
                  </div>
                  <div className="ws-dossier-field">
                    <span className="ws-dossier-lbl">Classification</span>
                    <span className="ws-dossier-val">
                      <span className="ws-project-badge">★ FINAL PROJECT</span>
                    </span>
                  </div>
                </div>
              </div>

              <div className="ws-dossier-card">
                <div className="ws-dossier-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  Attribution &amp; Technical Scope
                </div>
                <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: '12.5px', marginBottom: '6px' }}>
                  Created by Bachelor of Science in Computer Science
                </div>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
                  Engineered as a comprehensive Final Project for Architecture and Organization at Holy Cross College SCITE. The workstation features a two-pass 8086 assembly parser, complete register telemetry (AX, BX, CX, DX with 8-bit high/low split, Pointers SP/BP/SI/DI/IP, and Segment Registers CS/DS/SS/ES), hardware flag evaluations (OF, DF, IF, TF, SF, ZF, AF, PF, CF), 64KB physical address memory visualization with live ASCII decoding, and DOS Interrupt 21h console input/output emulation.
                </p>
              </div>
            </div>

            <div className="ws-modal-actions">
              <button className="ws-action-btn btn-compile" onClick={() => setShowInfoModal(false)}>
                Close Dossier
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Examples Modal */}
      {showExamplesModal && (
        <div className="ws-modal-overlay" onClick={() => setShowExamplesModal(false)}>
          <div className="ws-modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="ws-modal-head">
              <div className="ws-modal-heading">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2">
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
                <span>Sample 8086 Assembly Programs</span>
              </div>
              <button className="ws-modal-x" onClick={() => setShowExamplesModal(false)}>✕</button>
            </div>

            <div className="ws-modal-content-area">
              <p style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                Select an assembly example to load into the workstation editor:
              </p>
              {SAMPLE_PROGRAMS.map((prog) => (
                <div
                  key={prog.id}
                  style={{
                    background: 'var(--bg-app)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '10px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                  onClick={() => {
                    stopRunning()
                    setCode(prog.code)
                    setLastCompiledCode(null)
                    setCompiled(null)
                    setCompileMessage(null)
                    setOutputText('')
                    outputRef.current = ''
                    setCpu(createInitialState())
                    setShowExamplesModal(false)
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '12px' }}>
                      {prog.title}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                      {prog.description}
                    </div>
                  </div>
                  <button className="ws-action-btn btn-step" style={{ height: '26px', fontSize: '10.5px' }}>
                    Load Code
                  </button>
                </div>
              ))}
            </div>

            <div className="ws-modal-actions">
              <button className="ws-action-btn btn-reset" onClick={() => setShowExamplesModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8086 Instruction Sets & Curriculum Manual Modal */}
      {showHelpModal && (
        <div className="ws-modal-overlay" onClick={() => setShowHelpModal(false)}>
          <div className="ws-modal-dialog ws-modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="ws-modal-head">
              <div className="ws-modal-heading">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#c084fc" strokeWidth="2">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
                <span>8086 Instruction Sets &amp; Architecture Reference</span>
                <span className="ws-pill" style={{ color: '#c084fc', borderColor: 'rgba(192, 132, 252, 0.4)' }}>
                  August 7, 2026 Curriculum
                </span>
              </div>
              <button className="ws-modal-x" onClick={() => setShowHelpModal(false)}>✕</button>
            </div>

            {/* Filter and Search Bar */}
            <div className="ws-ins-filter-bar">
              <input
                type="text"
                className="ws-ins-search-input"
                placeholder="Search mnemonic, category, syntax, or register (e.g., MOV, XLAT, AAM, DAA, LOOP, MAR, Word)..."
                value={insSearch}
                onChange={(e) => setInsSearch(e.target.value)}
                autoFocus
              />

              <div className="ws-ins-pills-row">
                {INSTRUCTION_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    className={`ws-ins-pill-btn ${insActiveCategory === cat.id ? 'active' : ''}`}
                    onClick={() => {
                      setInsActiveCategory(cat.id)
                      setInsSearch('')
                    }}
                  >
                    {cat.title}
                  </button>
                ))}
              </div>
            </div>

            {/* Modal Body */}
            <div className="ws-modal-content-area" style={{ maxHeight: '65vh' }}>
              {/* Category 9: Architecture & Units or Search contains architecture keywords */}
              {(insActiveCategory === 9 || insSearch.toLowerCase().includes('mar') || insSearch.toLowerCase().includes('mdr') || insSearch.toLowerCase().includes('word') || insSearch.toLowerCase().includes('byte') || insSearch.toLowerCase().includes('nibble') || insSearch.toLowerCase().includes('unit')) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '10px' }}>
                  {/* CPU Architecture & Internal Registers Block (Slides 5 & 6) */}
                  <div className="ws-dossier-card">
                    <div className="ws-dossier-title">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="4" y="4" width="16" height="16" rx="2" />
                        <rect x="9" y="9" width="6" height="6" />
                      </svg>
                      Central Processing Unit Architecture &amp; Internal Registers
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px' }}>
                      <div className="ws-cpu-block-layout">
                        <div style={{ fontSize: '11px', fontWeight: 700, color: '#f8fafc', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '4px' }}>
                          CPU Functional Core Subsystems
                        </div>
                        <div className="ws-cpu-sub-box highlight">
                          <span style={{ fontWeight: 600, color: '#c084fc' }}>Control Unit (CU)</span>
                          <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>Timing &amp; Control</span>
                        </div>
                        <div className="ws-cpu-sub-box highlight">
                          <span style={{ fontWeight: 600, color: 'var(--accent-amber)' }}>Arithmetic / Logic Unit (ALU)</span>
                          <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>8 &amp; 16-bit Math</span>
                        </div>
                        <div className="ws-cpu-sub-box">
                          <span style={{ fontWeight: 600, color: '#38bdf8' }}>Memory Unit</span>
                          <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>64KB Segments (1MB Max)</span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        {CPU_INTERNAL_REGISTERS.map((reg) => (
                          <div key={reg.code} className="ws-cpu-sub-box">
                            <div>
                              <strong style={{ color: '#c084fc', fontFamily: 'var(--font-mono)', marginRight: '6px' }}>{reg.code}</strong>
                              <span style={{ fontSize: '11px', color: 'var(--text-primary)' }}>{reg.name}</span>
                              <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>{reg.description}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Data Units & Storage Hierarchy (Slides 3, 4, 7) */}
                  <div className="ws-dossier-card">
                    <div className="ws-dossier-title">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="20" x2="18" y2="10" />
                        <line x1="12" y1="20" x2="12" y2="4" />
                        <line x1="6" y1="20" x2="6" y2="14" />
                      </svg>
                      8086 Binary Data Units &amp; Register Bit Distribution
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
                      {STORAGE_UNITS.map((unit) => (
                        <div key={unit.name} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)', padding: '7px 10px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                            <span style={{ fontWeight: 700, fontSize: '11.5px', color: '#f8fafc' }}>{unit.name}</span>
                            <span className="ws-pill" style={{ fontSize: '9px', fontFamily: 'var(--font-mono)' }}>{unit.representation}</span>
                          </div>
                          <div style={{ fontSize: '10.5px', color: 'var(--accent-amber)', fontFamily: 'var(--font-mono)' }}>{unit.conversion}</div>
                          <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '3px' }}>{unit.description}</div>
                        </div>
                      ))}
                    </div>

                    {/* General Register Split (AX = AH:AL) */}
                    <div style={{ marginTop: '8px', background: 'var(--bg-card)', padding: '8px 12px', borderRadius: 'var(--radius-xs)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '5px' }}>
                        16-bit Register Split Matrix (Slide 7):
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr', gap: '6px', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                        <span style={{ color: 'var(--text-tertiary)' }}>Register</span>
                        <span style={{ color: '#c084fc', textAlign: 'center', background: 'var(--bg-app)', padding: '2px 4px', borderRadius: '2px' }}>AH (Bits 15-8, MSB)</span>
                        <span style={{ color: '#38bdf8', textAlign: 'center', background: 'var(--bg-app)', padding: '2px 4px', borderRadius: '2px' }}>AL (Bits 7-0, LSB)</span>

                        <span style={{ fontWeight: 700, color: 'var(--accent-amber)' }}>AX (16-bit)</span>
                        <span style={{ background: 'var(--bg-subtle)', padding: '2px', textAlign: 'center' }}>Accumulator High</span>
                        <span style={{ background: 'var(--bg-subtle)', padding: '2px', textAlign: 'center' }}>Accumulator Low</span>

                        <span style={{ fontWeight: 700, color: 'var(--accent-amber)' }}>BX (16-bit)</span>
                        <span style={{ background: 'var(--bg-subtle)', padding: '2px', textAlign: 'center' }}>Base High</span>
                        <span style={{ background: 'var(--bg-subtle)', padding: '2px', textAlign: 'center' }}>Base Low</span>

                        <span style={{ fontWeight: 700, color: 'var(--accent-amber)' }}>CX (16-bit)</span>
                        <span style={{ background: 'var(--bg-subtle)', padding: '2px', textAlign: 'center' }}>Count High</span>
                        <span style={{ background: 'var(--bg-subtle)', padding: '2px', textAlign: 'center' }}>Count Low</span>

                        <span style={{ fontWeight: 700, color: 'var(--accent-amber)' }}>DX (16-bit)</span>
                        <span style={{ background: 'var(--bg-subtle)', padding: '2px', textAlign: 'center' }}>Data High</span>
                        <span style={{ background: 'var(--bg-subtle)', padding: '2px', textAlign: 'center' }}>Data Low</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Instructions Table */}
              {insActiveCategory !== 9 && (
                <table className="ws-ins-table">
                  <thead>
                    <tr>
                      <th style={{ width: '130px' }}>Mnemonic</th>
                      <th style={{ width: '125px' }}>Category</th>
                      <th>Syntax &amp; Curriculum Description</th>
                      <th style={{ width: '140px' }}>Flags</th>
                      <th style={{ width: '70px', textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInstructions.length > 0 ? (
                      filteredInstructions.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <span className="ws-ins-chip">{item.mnemonic}</span>
                          </td>
                          <td>
                            <span className="ws-ins-cat-badge">{item.categoryName}</span>
                          </td>
                          <td>
                            <div className="ws-ins-syntax">{item.syntax}</div>
                            <div style={{ color: 'var(--text-secondary)', lineHeight: '1.45', fontSize: '11px' }}>
                              {item.description}
                            </div>
                          </td>
                          <td>
                            <span className="ws-ins-flags">{item.flagsAffected || 'None'}</span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              className="ws-insert-btn"
                              onClick={() => handleInsertInstruction(item.sampleCode || `${item.mnemonic}`)}
                              title={`Insert ${item.mnemonic} template into editor`}
                            >
                              Insert
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-dim)' }}>
                          No instructions matching "{insSearch}". Try another search keyword or select a category tab.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>

            <div className="ws-modal-actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                Source: Microprocessor - 8086 Instruction Sets (Slide Deck August 7, 2026)
              </span>
              <button className="ws-action-btn btn-compile" onClick={() => setShowHelpModal(false)}>
                Close Manual
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default App
