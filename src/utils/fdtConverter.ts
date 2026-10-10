import { FdtNode, FdtProperty } from '../types';

const FDT_MAGIC = 0xd00dfeed;
const OF_DT_BEGIN_NODE = 0x00000001;
const OF_DT_END_NODE = 0x00000002;
const OF_DT_PROP = 0x00000003;
const OF_DT_NOP = 0x00000004;
const OF_DT_END = 0x00000009;

export interface FdtParseResult {
  success: boolean;
  dtsText: string;
  rootNode?: FdtNode;
  header?: {
    magic: number;
    totalSize: number;
    offDtStruct: number;
    offDtStrings: number;
    offMemRsvmap: number;
    version: number;
    lastCompVersion: number;
    bootCpuidPhys: number;
    sizeDtStrings: number;
    sizeDtStruct: number;
  };
  nodeCount: number;
  propCount: number;
  error?: string;
}

/**
 * Decompiles binary DTB buffer into DTS text and node tree
 */
export function decompileDtb(buffer: Uint8Array): FdtParseResult {
  try {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    if (buffer.length < 40) {
      return { success: false, dtsText: '', nodeCount: 0, propCount: 0, error: 'File too small to be a valid DTB (< 40 bytes)' };
    }

    const magic = view.getUint32(0, false); // Big Endian
    if (magic !== FDT_MAGIC) {
      return {
        success: false,
        dtsText: '',
        nodeCount: 0,
        propCount: 0,
        error: `Invalid FDT magic: 0x${magic.toString(16)} (expected 0xd00dfeed). This file does not appear to be a Device Tree Blob.`
      };
    }

    const totalSize = view.getUint32(4, false);
    const offDtStruct = view.getUint32(8, false);
    const offDtStrings = view.getUint32(12, false);
    const offMemRsvmap = view.getUint32(16, false);
    const version = view.getUint32(20, false);
    const lastCompVersion = view.getUint32(24, false);
    const bootCpuidPhys = view.getUint32(28, false);
    const sizeDtStrings = view.getUint32(32, false);
    const sizeDtStruct = view.getUint32(36, false);

    const header = {
      magic,
      totalSize,
      offDtStruct,
      offDtStrings,
      offMemRsvmap,
      version,
      lastCompVersion,
      bootCpuidPhys,
      sizeDtStrings,
      sizeDtStruct
    };

    // Helper to read null-terminated string from strings block
    const getString = (offset: number): string => {
      let str = '';
      let idx = offDtStrings + offset;
      while (idx < buffer.length && buffer[idx] !== 0) {
        str += String.fromCharCode(buffer[idx]);
        idx++;
      }
      return str;
    };

    let offset = offDtStruct;
    let nodeCount = 0;
    let propCount = 0;

    // Node stack for tree construction
    const rootNode: FdtNode = { name: '/', path: '/', properties: [], children: [] };
    const stack: FdtNode[] = [rootNode];

    while (offset < buffer.length) {
      const tag = view.getUint32(offset, false);
      offset += 4;

      if (tag === OF_DT_BEGIN_NODE) {
        let name = '';
        while (offset < buffer.length && buffer[offset] !== 0) {
          name += String.fromCharCode(buffer[offset]);
          offset++;
        }
        offset++; // Skip null terminator
        while (offset % 4 !== 0) offset++; // 4-byte align

        if (name === '') name = '/';

        const parent = stack[stack.length - 1];
        const currentPath = parent.path === '/' ? `/${name}` : `${parent.path}/${name}`;
        const newNode: FdtNode = {
          name: name === '/' ? '/' : name,
          path: currentPath,
          properties: [],
          children: []
        };

        if (stack.length === 1 && name === '/') {
          // root node itself
        } else {
          parent.children.push(newNode);
          stack.push(newNode);
        }
        nodeCount++;
      } else if (tag === OF_DT_END_NODE) {
        if (stack.length > 1) {
          stack.pop();
        }
      } else if (tag === OF_DT_PROP) {
        const len = view.getUint32(offset, false);
        const nameoff = view.getUint32(offset + 4, false);
        offset += 8;

        const propName = getString(nameoff);
        const propBytes = buffer.slice(offset, offset + len);
        offset += len;
        while (offset % 4 !== 0) offset++; // 4-byte align

        // Determine property value representation
        const current = stack[stack.length - 1];
        const prop = formatProperty(propName, propBytes);
        current.properties.push(prop);
        propCount++;
      } else if (tag === OF_DT_NOP) {
        // No operation
      } else if (tag === OF_DT_END) {
        break;
      } else {
        // Unknown or unexpected tag
        break;
      }
    }

    // Format DTS text
    const dtsText = serializeNodeToDts(rootNode);

    return {
      success: true,
      dtsText: `/dts-v1/;\n\n${dtsText}`,
      rootNode,
      header,
      nodeCount,
      propCount
    };
  } catch (err) {
    return {
      success: false,
      dtsText: '',
      nodeCount: 0,
      propCount: 0,
      error: `Decompilation error: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

/**
 * Heuristically determines property type and formats it for DTS representation
 */
function formatProperty(name: string, bytes: Uint8Array): FdtProperty {
  if (bytes.length === 0) {
    return { name, value: '', rawType: 'empty', rawBytes: bytes };
  }

  // Check if it is a printable string or string-list
  let isPrintable = true;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0) {
      // Allowed null terminator
    } else if (b < 32 || b > 126) {
      isPrintable = false;
      break;
    }
  }

  // If printable and ends with null byte
  if (isPrintable && bytes.length > 1 && bytes[bytes.length - 1] === 0) {
    const parts: string[] = [];
    let cur = '';
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0) {
        if (cur.length > 0) {
          parts.push(cur);
          cur = '';
        }
      } else {
        cur += String.fromCharCode(bytes[i]);
      }
    }

    if (parts.length > 0) {
      const formatted = parts.map(p => `"${escapeString(p)}"`).join(', ');
      return { name, value: formatted, rawType: 'string', rawBytes: bytes };
    }
  }

  // Check if it's 32-bit big-endian cell(s)
  if (bytes.length % 4 === 0) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const cells: string[] = [];
    for (let i = 0; i < bytes.length; i += 4) {
      const val = view.getUint32(i, false);
      if (val === 0) {
        cells.push('0x0');
      } else {
        cells.push('0x' + val.toString(16));
      }
    }
    return { name, value: `<${cells.join(' ')}>`, rawType: 'u32-array', rawBytes: bytes };
  }

  // Fallback to byte array [00 1a ...]
  const byteHex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
  return { name, value: `[${byteHex}]`, rawType: 'byte-array', rawBytes: bytes };
}

function escapeString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Formats a node tree recursively into standard DTS format
 */
function serializeNodeToDts(node: FdtNode, depth = 0): string {
  const indent = '    '.repeat(depth);
  let out = '';

  const nodeHeader = node.name === '/' ? '/ {' : `${node.name} {`;
  out += `${indent}${nodeHeader}\n`;

  // Properties
  for (const prop of node.properties) {
    if (prop.rawType === 'empty') {
      out += `${indent}    ${prop.name};\n`;
    } else {
      out += `${indent}    ${prop.name} = ${prop.value};\n`;
    }
  }

  if (node.properties.length > 0 && node.children.length > 0) {
    out += '\n';
  }

  // Children
  for (let i = 0; i < node.children.length; i++) {
    out += serializeNodeToDts(node.children[i], depth + 1);
    if (i < node.children.length - 1) {
      out += '\n';
    }
  }

  out += `${indent}};\n`;
  return out;
}

/**
 * Compiles Device Tree Source text into binary DTB Uint8Array
 */
export function compileDts(dtsText: string): { success: boolean; dtb?: Uint8Array; sizeBytes: number; error?: string } {
  try {
    // Strip comments (/* ... */ and // ...)
    const cleanDts = dtsText
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/\/dts-v1\/;?/g, '')
      .trim();

    const root = parseDtsToNodeTree(cleanDts);
    if (!root) {
      return { success: false, sizeBytes: 0, error: 'Failed to parse DTS root node "/"' };
    }

    // Build DTB binary
    const stringTable: string[] = [];
    const stringOffsets = new Map<string, number>();
    let stringBytesCount = 0;

    const addString = (name: string): number => {
      if (stringOffsets.has(name)) {
        return stringOffsets.get(name)!;
      }
      const offset = stringBytesCount;
      stringOffsets.set(name, offset);
      stringTable.push(name);
      stringBytesCount += name.length + 1; // including null terminator
      return offset;
    };

    // Pre-populate string table
    const collectStrings = (node: FdtNode) => {
      for (const p of node.properties) {
        addString(p.name);
      }
      for (const child of node.children) {
        collectStrings(child);
      }
    };
    collectStrings(root);

    // Build Struct Block
    const structBytes: number[] = [];

    const appendU32 = (val: number) => {
      structBytes.push((val >>> 24) & 0xff);
      structBytes.push((val >>> 16) & 0xff);
      structBytes.push((val >>> 8) & 0xff);
      structBytes.push(val & 0xff);
    };

    const appendBytes = (bytes: Uint8Array | number[]) => {
      for (let i = 0; i < bytes.length; i++) {
        structBytes.push(bytes[i]);
      }
      while (structBytes.length % 4 !== 0) {
        structBytes.push(0);
      }
    };

    const serializeNodeToBinary = (node: FdtNode) => {
      appendU32(OF_DT_BEGIN_NODE);
      const name = node.name === '/' ? '' : node.name;
      const nameBytes: number[] = [];
      for (let i = 0; i < name.length; i++) {
        nameBytes.push(name.charCodeAt(i));
      }
      nameBytes.push(0); // Null terminator
      appendBytes(nameBytes);

      for (const prop of node.properties) {
        appendU32(OF_DT_PROP);
        const propBytes = prop.rawBytes || serializePropertyValue(prop.value, prop.rawType);
        appendU32(propBytes.length);
        const nameoff = addString(prop.name);
        appendU32(nameoff);
        appendBytes(propBytes);
      }

      for (const child of node.children) {
        serializeNodeToBinary(child);
      }

      appendU32(OF_DT_END_NODE);
    };

    serializeNodeToBinary(root);
    appendU32(OF_DT_END);

    // String Block buffer
    const stringsBuf = new Uint8Array(stringBytesCount);
    let sIdx = 0;
    for (const s of stringTable) {
      for (let i = 0; i < s.length; i++) {
        stringsBuf[sIdx++] = s.charCodeAt(i);
      }
      stringsBuf[sIdx++] = 0;
    }

    // Memory Reservation Map (16 bytes: two 64-bit zeros for address and size)
    const memRsvLen = 16;
    const headerLen = 40;

    const offMemRsvmap = headerLen;
    const offDtStruct = offMemRsvmap + memRsvLen;
    const offDtStrings = offDtStruct + structBytes.length;
    const totalSize = offDtStrings + stringsBuf.length;

    const finalBuffer = new Uint8Array(totalSize);
    const view = new DataView(finalBuffer.buffer);

    // Write FDT Header (Big Endian)
    view.setUint32(0, FDT_MAGIC, false);
    view.setUint32(4, totalSize, false);
    view.setUint32(8, offDtStruct, false);
    view.setUint32(12, offDtStrings, false);
    view.setUint32(16, offMemRsvmap, false);
    view.setUint32(20, 17, false); // version 17
    view.setUint32(24, 16, false); // last compatible version 16
    view.setUint32(28, 0, false);  // boot_cpuid_phys
    view.setUint32(32, stringsBuf.length, false);
    view.setUint32(36, structBytes.length, false);

    // Memory reservation map is all 0s (already zero-initialized)

    // Struct block
    finalBuffer.set(new Uint8Array(structBytes), offDtStruct);

    // Strings block
    finalBuffer.set(stringsBuf, offDtStrings);

    return {
      success: true,
      dtb: finalBuffer,
      sizeBytes: totalSize
    };
  } catch (err) {
    return {
      success: false,
      sizeBytes: 0,
      error: `DTS compilation error: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

/**
 * Parses raw DTS string values back to binary bytes
 */
function serializePropertyValue(valStr: string, rawType: string): Uint8Array {
  const trimmed = valStr.trim();
  if (!trimmed || rawType === 'empty') {
    return new Uint8Array(0);
  }

  // String(s): "string1", "string2"
  if (trimmed.startsWith('"')) {
    const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"/g;
    let match;
    const bytes: number[] = [];
    while ((match = regex.exec(trimmed)) !== null) {
      const strVal = match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      for (let i = 0; i < strVal.length; i++) {
        bytes.push(strVal.charCodeAt(i));
      }
      bytes.push(0);
    }
    return new Uint8Array(bytes);
  }

  // Cells / u32 array: <0x123 0x456 123>
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return new Uint8Array(0);
    const tokens = inner.split(/\s+/);
    const buffer = new Uint8Array(tokens.length * 4);
    const view = new DataView(buffer.buffer);
    tokens.forEach((t, i) => {
      let num = 0;
      if (t.toLowerCase().startsWith('0x')) {
        num = parseInt(t, 16);
      } else {
        num = parseInt(t, 10);
      }
      if (isNaN(num)) num = 0;
      view.setUint32(i * 4, num, false); // Big endian
    });
    return buffer;
  }

  // Byte array: [1a 2b 3c]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return new Uint8Array(0);
    const tokens = inner.split(/\s+/);
    const buffer = new Uint8Array(tokens.length);
    tokens.forEach((t, i) => {
      buffer[i] = parseInt(t, 16) || 0;
    });
    return buffer;
  }

  // Fallback as string with null byte
  const res = new Uint8Array(trimmed.length + 1);
  for (let i = 0; i < trimmed.length; i++) {
    res[i] = trimmed.charCodeAt(i);
  }
  res[trimmed.length] = 0;
  return res;
}

/**
 * Simple recursive descent DTS parser
 */
function parseDtsToNodeTree(dts: string): FdtNode | null {
  const root: FdtNode = { name: '/', path: '/', properties: [], children: [] };
  const stack: FdtNode[] = [root];

  // Regex tokenizer for DTS constructs
  // matches:
  // 1. Node start: ([\w@,.-]+|\/)\s*\{
  // 2. Node end: \};
  // 3. Property: ([\w,.-]+)\s*(=\s*([^;]+))?;
  const tokenRegex = /([a-zA-Z0-9@_,\.\-+]+|\/)\s*\{|\};\s*|([a-zA-Z0-9#_,\.\-+]+)\s*(?:=\s*([^;]+))?;\s*/g;
  let match;

  while ((match = tokenRegex.exec(dts)) !== null) {
    const full = match[0];
    if (full.endsWith('{')) {
      const nodeName = match[1] || '';
      if (nodeName === '/' && stack.length === 1) {
        // Root node
        continue;
      }
      const parent = stack[stack.length - 1];
      const newNode: FdtNode = {
        name: nodeName,
        path: parent.path === '/' ? `/${nodeName}` : `${parent.path}/${nodeName}`,
        properties: [],
        children: []
      };
      parent.children.push(newNode);
      stack.push(newNode);
    } else if (full.trim().startsWith('};')) {
      if (stack.length > 1) {
        stack.pop();
      }
    } else {
      // Property
      const propName = match[2];
      const propVal = match[3]?.trim() || '';
      if (propName) {
        const cur = stack[stack.length - 1];
        let rawType: 'string' | 'u32-array' | 'byte-array' | 'empty' = 'empty';
        if (propVal.startsWith('"')) rawType = 'string';
        else if (propVal.startsWith('<')) rawType = 'u32-array';
        else if (propVal.startsWith('[')) rawType = 'byte-array';

        cur.properties.push({
          name: propName,
          value: propVal,
          rawType
        });
      }
    }
  }

  return root;
}

/**
 * Sample Device Tree Source presets for Samsung Exynos, Qualcomm Snapdragon, and Mainline ARM64
 */
export const SAMPLE_DTS_PRESETS = {
  samsung_exynos: `/dts-v1/;

/ {
    model = "Samsung Galaxy S20 / Note 20 (Exynos 990)";
    compatible = "samsung,xcover-pro", "samsung,exynos990", "samsung,universal9830";
    #address-cells = <0x2>;
    #size-cells = <0x2>;
    interrupt-parent = <&gic>;

    chosen {
        bootargs = "console=ttySAC2,115200n8 earlycon=exynos4210,0x10a20000 androidboot.selinux=permissive androidboot.hardware=exynos990 loop.max_part=7";
        stdout-path = "serial2:115200n8";
    };

    memory@80000000 {
        device_type = "memory";
        reg = <0x0 0x80000000 0x2 0x0>; /* 8GB LPDDR5 */
    };

    cpus {
        #address-cells = <0x1>;
        #size-cells = <0x0>;

        cpu-map {
            cluster0 {
                core0 { cpu = <&cpu0>; };
                core1 { cpu = <&cpu1>; };
                core2 { cpu = <&cpu2>; };
                core3 { cpu = <&cpu3>; };
            };
            cluster1 {
                core0 { cpu = <&cpu4>; };
                core1 { cpu = <&cpu5>; };
            };
            cluster2 {
                core0 { cpu = <&cpu6>; };
                core1 { cpu = <&cpu7>; };
            };
        };

        cpu0: cpu@0 {
            device_type = "cpu";
            compatible = "arm,cortex-a55";
            reg = <0x0>;
            enable-method = "psci";
            clocks = <&cmu_cpu 0x1>;
        };

        cpu4: cpu@100 {
            device_type = "cpu";
            compatible = "arm,cortex-a76";
            reg = <0x100>;
            enable-method = "psci";
        };

        cpu6: cpu@200 {
            device_type = "cpu";
            compatible = "samsung,exynos-m5";
            reg = <0x200>;
            enable-method = "psci";
        };
    };

    soc {
        compatible = "simple-bus";
        #address-cells = <0x2>;
        #size-cells = <0x2>;
        ranges;

        gic: interrupt-controller@10100000 {
            compatible = "arm,gic-v3";
            #interrupt-cells = <0x3>;
            interrupt-controller;
            reg = <0x0 0x10100000 0x0 0x10000>,
                  <0x0 0x10160000 0x0 0x200000>;
        };

        serial2: serial@10a20000 {
            compatible = "samsung,exynos-uart";
            reg = <0x0 0x10a20000 0x0 0x100>;
            interrupts = <0x0 0x140 0x4>;
            status = "okay";
        };

        mali: gpu@14ac0000 {
            compatible = "arm,mali-valhall-g77", "arm,mali-midgard";
            reg = <0x0 0x14ac0000 0x0 0x40000>;
            interrupts = <0x0 0xb0 0x4>;
            samsung,power-domain = <&pd_g3d>;
            status = "okay";
        };
    };
};`,

  qualcomm_mainline: `/dts-v1/;

/ {
    model = "Qualcomm Technologies, Inc. SM8550 Mainline Board";
    compatible = "qcom,sm8550-hdk", "qcom,sm8550";
    #address-cells = <0x2>;
    #size-cells = <0x2>;

    chosen {
        bootargs = "console=ttyMSM0,115200n8 earlycon=msm_geni_serial,0xa90000 clk_ignore_unused pd_ignore_unused androidboot.hardware=qcom rootwait";
        stdout-path = "serial0:115200n8";
    };

    memory@80000000 {
        device_type = "memory";
        reg = <0x0 0x80000000 0x3 0x0>; /* 12GB RAM */
    };

    soc: soc@0 {
        compatible = "simple-bus";
        #address-cells = <0x2>;
        #size-cells = <0x2>;
        ranges;

        serial0: serial@a90000 {
            compatible = "qcom,geni-debug-uart";
            reg = <0x0 0xa90000 0x0 0x4000>;
            clocks = <&gcc 0x3f>;
            status = "okay";
        };

        ufs_mem: ufs@1d84000 {
            compatible = "qcom,sm8550-ufshc", "qcom,ufshc";
            reg = <0x0 0x1d84000 0x0 0x3000>;
            status = "okay";
        };

        gpu: gpu@3d00000 {
            compatible = "qcom,adreno-740.0", "qcom,adreno";
            reg = <0x0 0x3d00000 0x0 0x40000>;
            status = "okay";
        };
    };
};`,

  generic_arm64_virt: `/dts-v1/;

/ {
    model = "ARM64 Generic Linux Mainline Android Guest";
    compatible = "linux,dummy-virt";
    #address-cells = <0x2>;
    #size-cells = <0x2>;

    chosen {
        bootargs = "console=ttyAMA0 earlycon=pl011,0x9000000 initcall_debug androidboot.hardware=generic_arm64";
        stdout-path = "/pl011@9000000";
    };

    memory@40000000 {
        device_type = "memory";
        reg = <0x0 0x40000000 0x1 0x0>; /* 4GB RAM */
    };

    cpus {
        #address-cells = <0x1>;
        #size-cells = <0x0>;
        cpu@0 {
            device_type = "cpu";
            compatible = "arm,arm-v8";
            reg = <0x0>;
            enable-method = "psci";
        };
        cpu@1 {
            device_type = "cpu";
            compatible = "arm,arm-v8";
            reg = <0x1>;
            enable-method = "psci";
        };
    };

    pl011@9000000 {
        compatible = "arm,pl011", "arm,primecell";
        reg = <0x0 0x9000000 0x0 0x1000>;
        interrupts = <0x0 0x1 0x4>;
    };
};`
};
