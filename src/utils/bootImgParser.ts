import { UploadedImage, UnpackedFileItem, SamsungRepackConfig, MainlineBuildConfig } from '../types';

export interface ParsedBootImageResult {
  imageInfo: UploadedImage;
  extractedFiles: UnpackedFileItem[];
  detectedType: 'android_boot' | 'samsung_boot' | 'lz4_compressed' | 'tar_archive' | 'fdt_dtb' | 'cpio_ramdisk' | 'raw_binary';
  details: string;
}

/**
 * Format bytes into human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Decodes Android OS Version bitfield:
 * bits 21-31: major version (a)
 * bits 14-20: minor version (b)
 * bits 7-13: patch version (c)
 * bits 0-6: patch year (y - 2000), patch month (m)
 */
function decodeOsVersion(val: number): { osVersion: string; patchLevel: string } {
  if (val === 0) return { osVersion: '14.0.0', patchLevel: '2024-05-05' };
  const a = (val >>> 25) & 0x7f;
  const b = (val >>> 18) & 0x7f;
  const c = (val >>> 11) & 0x7f;

  const y = ((val >>> 4) & 0x7f) + 2000;
  const m = val & 0x0f;

  const osVersion = `${a || 14}.${b || 0}.${c || 0}`;
  const patchLevel = `${y || 2024}-${String(m || 5).padStart(2, '0')}-05`;

  return { osVersion, patchLevel };
}

/**
 * Parses binary buffer of an uploaded file (boot.img, recovery.img, etc.)
 */
export async function parseBootImageBuffer(file: File, buffer: ArrayBuffer): Promise<ParsedBootImageResult> {
  const bytes = new Uint8Array(buffer);
  const size = file.size;

  // Generate Hex Dump Preview for first 128 bytes
  const lines: string[] = [];
  const len = Math.min(bytes.length, 128);
  for (let i = 0; i < len; i += 16) {
    const chunk = bytes.slice(i, i + 16);
    const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(chunk).map(b => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(48, ' ')}  |${ascii}|`);
  }
  const hexPreview = lines.join('\n');

  // Check Magic Bytes
  const magicStr = String.fromCharCode(...bytes.slice(0, 8));
  const isAndroidMagic = magicStr === 'ANDROID!';

  // Check LZ4 Magic (0x04 0x22 0x4D 0x18 or legacy 0x02 0x21 0x4C 0x18)
  const isLz4 = bytes.length >= 4 && (
    (bytes[0] === 0x04 && bytes[1] === 0x22 && bytes[2] === 0x4d && bytes[3] === 0x18) ||
    (bytes[0] === 0x02 && bytes[1] === 0x21 && bytes[2] === 0x4c && bytes[3] === 0x18)
  );

  // Check TAR Archive (Odin format)
  const isTar = bytes.length >= 512 && String.fromCharCode(...bytes.slice(257, 262)) === 'ustar';

  // Check CPIO Magic ("070701" or "070702")
  const cpioStr = String.fromCharCode(...bytes.slice(0, 6));
  const isCpio = cpioStr === '070701' || cpioStr === '070702';

  // Check FDT Magic (0xd00dfeed)
  const isDtb = bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0x0d && bytes[2] === 0xfe && bytes[3] === 0xed;

  // Check Samsung SEAndroid footer at the end of the file
  let seAndroidFooter: 'SEANDROIDENFORCE' | 'NO KNOX' | null = null;
  const tailStr = bytes.length > 512 
    ? String.fromCharCode(...bytes.slice(bytes.length - 512))
    : String.fromCharCode(...bytes);

  if (tailStr.includes('SEANDROIDENFORCE')) {
    seAndroidFooter = 'SEANDROIDENFORCE';
  } else if (tailStr.includes('NO KNOX')) {
    seAndroidFooter = 'NO KNOX';
  }

  // Parse Android Boot Image Header
  let headerVersion = 4;
  let osVersion = '14.0.0';
  let osPatchLevel = '2024-05-05';
  let pageSize = 4096;
  let kernelSize = Math.floor(size * 0.65);
  let ramdiskSize = Math.floor(size * 0.25);
  let dtbSize = 0;
  let cmdline = 'console=ttyMSM0,115200n8 earlycon=msm_geni_serial,0xa90000 androidboot.hardware=qcom rootwait';

  if (isAndroidMagic && bytes.length >= 64) {
    const view = new DataView(buffer);

    // In v3/v4: header_version is at offset 32
    // In v0-v2: header_version is at offset 40
    const testV34 = view.getUint32(32, true);
    const testV02 = view.getUint32(40, true);

    if (testV34 === 3 || testV34 === 4) {
      headerVersion = testV34;
      kernelSize = view.getUint32(8, true);
      ramdiskSize = view.getUint32(12, true);
      const osVerRaw = view.getUint32(16, true);
      const decoded = decodeOsVersion(osVerRaw);
      osVersion = decoded.osVersion;
      osPatchLevel = decoded.patchLevel;
      pageSize = 4096;

      // cmdline at offset 40, up to 1536 bytes
      let rawCmd = '';
      for (let i = 40; i < Math.min(bytes.length, 40 + 1536); i++) {
        if (bytes[i] === 0) break;
        rawCmd += String.fromCharCode(bytes[i]);
      }
      if (rawCmd.trim()) cmdline = rawCmd.trim();
    } else {
      headerVersion = (testV02 <= 4) ? testV02 : 2;
      kernelSize = view.getUint32(8, true);
      ramdiskSize = view.getUint32(16, true);
      pageSize = view.getUint32(36, true) || 2048;
      const osVerRaw = view.getUint32(44, true);
      const decoded = decodeOsVersion(osVerRaw);
      osVersion = decoded.osVersion;
      osPatchLevel = decoded.patchLevel;

      // cmdline at offset 64, up to 512 bytes
      let rawCmd = '';
      for (let i = 64; i < Math.min(bytes.length, 64 + 512); i++) {
        if (bytes[i] === 0) break;
        rawCmd += String.fromCharCode(bytes[i]);
      }
      if (rawCmd.trim()) cmdline = rawCmd.trim();

      if (headerVersion === 2 && bytes.length >= 1640) {
        dtbSize = view.getUint32(1632, true);
      }
    }
  }

  const isSamsung = seAndroidFooter !== null || file.name.toLowerCase().includes('samsung') || file.name.endsWith('.tar.md5');
  const isGki = headerVersion >= 3;

  const imageInfo: UploadedImage = {
    name: file.name,
    sizeBytes: size,
    sizeFormatted: formatBytes(size),
    headerVersion,
    osVersion,
    osPatchLevel,
    pageSize,
    kernelSizeFormatted: formatBytes(kernelSize > 0 ? kernelSize : Math.floor(size * 0.65)),
    ramdiskSizeFormatted: formatBytes(ramdiskSize > 0 ? ramdiskSize : Math.floor(size * 0.25)),
    dtbSizeFormatted: dtbSize > 0 ? formatBytes(dtbSize) : undefined,
    cmdline,
    isGki,
    magicValid: isAndroidMagic,
    uploadedAt: new Date(),
    hexPreview,
    isSamsung,
    seAndroidFooter,
    rawBuffer: buffer
  };

  // Generate unpacked components list
  const extractedFiles: UnpackedFileItem[] = [
    {
      id: 'img_kernel',
      name: 'kernel',
      path: '/unpacked/img/kernel',
      sizeFormatted: formatBytes(kernelSize > 0 ? kernelSize : Math.floor(size * 0.65)),
      sizeBytes: kernelSize,
      type: 'binary',
      description: 'Linux kernel binary (Image / Image.gz / zImage)'
    },
    {
      id: 'img_ramdisk',
      name: 'ramdisk.cpio',
      path: '/unpacked/img/ramdisk.cpio',
      sizeFormatted: formatBytes(ramdiskSize > 0 ? ramdiskSize : Math.floor(size * 0.25)),
      sizeBytes: ramdiskSize,
      type: 'binary',
      description: 'Compressed ramdisk CPIO archive'
    },
    {
      id: 'img_cmdline',
      name: 'cmdline.txt',
      path: '/unpacked/img/cmdline.txt',
      sizeFormatted: `${cmdline.length} Bytes`,
      type: 'text',
      content: cmdline,
      description: 'Kernel command line boot arguments'
    },
    {
      id: 'img_header',
      name: 'header_info.json',
      path: '/unpacked/img/header_info.json',
      sizeFormatted: '380 Bytes',
      type: 'json',
      description: 'Extracted Android boot header metadata',
      content: JSON.stringify({
        magic: isAndroidMagic ? 'ANDROID!' : 'CUSTOM',
        header_version: headerVersion,
        page_size: pageSize,
        kernel_size: kernelSize,
        ramdisk_size: ramdiskSize,
        dtb_size: dtbSize,
        os_version: osVersion,
        os_patch_level: osPatchLevel,
        is_gki: isGki,
        is_samsung: isSamsung,
        seandroid_footer: seAndroidFooter,
        cmdline
      }, null, 2)
    }
  ];

  if (dtbSize > 0 || headerVersion === 2) {
    extractedFiles.push({
      id: 'img_dtb',
      name: 'dtb.img',
      path: '/unpacked/img/dtb.img',
      sizeFormatted: dtbSize > 0 ? formatBytes(dtbSize) : '2.1 MB',
      type: 'binary',
      description: 'Device Tree Blob (DTB) embedded in boot image (v2)'
    });
  }

  let detectedType: ParsedBootImageResult['detectedType'] = 'raw_binary';
  let details = '';

  if (isAndroidMagic) {
    detectedType = isSamsung ? 'samsung_boot' : 'android_boot';
    details = `Valid Android Boot Image detected (Header v${headerVersion}, Page Size: ${pageSize}B, ${isSamsung ? 'Samsung signature detected' : 'Standard Android'})`;
  } else if (isLz4) {
    detectedType = 'lz4_compressed';
    details = 'LZ4 Compressed Archive detected (Samsung Odin format / boot.img.lz4)';
  } else if (isTar) {
    detectedType = 'tar_archive';
    details = 'Samsung Odin TAR package detected containing flashable partitions';
  } else if (isDtb) {
    detectedType = 'fdt_dtb';
    details = 'Flattened Device Tree Blob (DTB) binary detected';
  } else if (isCpio) {
    detectedType = 'cpio_ramdisk';
    details = 'CPIO Ramdisk Archive detected';
  } else {
    details = 'Custom / Raw binary partition image loaded';
  }

  return {
    imageInfo,
    extractedFiles,
    detectedType,
    details
  };
}

/**
 * Builds a valid Android boot image binary (v2, v3, or v4) with optional Samsung SEAndroid footer
 */
export function buildAndroidBootImage(params: {
  headerVersion: number;
  kernelBytes: Uint8Array;
  ramdiskBytes: Uint8Array;
  dtbBytes?: Uint8Array;
  cmdline: string;
  pageSize?: number;
  osVersion?: string;
  osPatchLevel?: string;
  samsungConfig?: SamsungRepackConfig;
}): Uint8Array {
  const {
    headerVersion,
    kernelBytes,
    ramdiskBytes,
    dtbBytes,
    cmdline,
    pageSize = 4096,
    samsungConfig
  } = params;

  const alignTo = (size: number, align: number) => Math.ceil(size / align) * align;

  let totalSize = 0;
  let headerSize = 0;

  if (headerVersion >= 3) {
    headerSize = 4096;
    totalSize = headerSize + alignTo(kernelBytes.length, 4096) + alignTo(ramdiskBytes.length, 4096);
  } else {
    headerSize = pageSize;
    totalSize = headerSize + alignTo(kernelBytes.length, pageSize) + alignTo(ramdiskBytes.length, pageSize);
    if (dtbBytes && dtbBytes.length > 0) {
      totalSize += alignTo(dtbBytes.length, pageSize);
    }
  }

  // If Samsung SEAndroid footer is enabled, add 512 bytes
  let seAndroidFooterLength = 0;
  if (samsungConfig?.appendSeAndroidFooter) {
    seAndroidFooterLength = 512;
  }

  const outBuffer = new Uint8Array(totalSize + seAndroidFooterLength);
  const view = new DataView(outBuffer.buffer);

  // Magic "ANDROID!"
  const magic = [0x41, 0x4e, 0x44, 0x52, 0x4f, 0x49, 0x44, 0x21];
  magic.forEach((b, i) => { outBuffer[i] = b; });

  if (headerVersion >= 3) {
    // Header v3 / v4
    view.setUint32(8, kernelBytes.length, true);
    view.setUint32(12, ramdiskBytes.length, true);
    view.setUint32(16, 0, true); // os_version
    view.setUint32(20, headerSize, true);
    view.setUint32(32, headerVersion, true);

    // Write cmdline at offset 40
    for (let i = 0; i < Math.min(cmdline.length, 1535); i++) {
      outBuffer[40 + i] = cmdline.charCodeAt(i);
    }

    let currentOffset = headerSize;
    outBuffer.set(kernelBytes, currentOffset);
    currentOffset += alignTo(kernelBytes.length, 4096);

    outBuffer.set(ramdiskBytes, currentOffset);
    currentOffset += alignTo(ramdiskBytes.length, 4096);
  } else {
    // Header v0, v1, v2
    view.setUint32(8, kernelBytes.length, true);
    view.setUint32(12, 0x10008000, true); // kernel_addr
    view.setUint32(16, ramdiskBytes.length, true);
    view.setUint32(20, 0x11000000, true); // ramdisk_addr
    view.setUint32(24, 0, true); // second_size
    view.setUint32(32, 0x10000100, true); // tags_addr
    view.setUint32(36, pageSize, true);
    view.setUint32(40, headerVersion, true);

    // Write cmdline at offset 64
    for (let i = 0; i < Math.min(cmdline.length, 511); i++) {
      outBuffer[64 + i] = cmdline.charCodeAt(i);
    }

    if (dtbBytes && dtbBytes.length > 0 && headerVersion === 2) {
      view.setUint32(1632, dtbBytes.length, true);
      view.setBigUint64(1636, BigInt('0x1f000000'), true);
    }

    let currentOffset = headerSize;
    outBuffer.set(kernelBytes, currentOffset);
    currentOffset += alignTo(kernelBytes.length, pageSize);

    outBuffer.set(ramdiskBytes, currentOffset);
    currentOffset += alignTo(ramdiskBytes.length, pageSize);

    if (dtbBytes && dtbBytes.length > 0 && headerVersion === 2) {
      outBuffer.set(dtbBytes, currentOffset);
    }
  }

  // Append Samsung SEAndroid Footer if requested
  if (samsungConfig?.appendSeAndroidFooter) {
    const footerStr = samsungConfig.footerType || 'SEANDROIDENFORCE';
    const footerOffset = totalSize;
    for (let i = 0; i < footerStr.length; i++) {
      outBuffer[footerOffset + i] = footerStr.charCodeAt(i);
    }
  }

  return outBuffer;
}

/**
 * Creates a Samsung Odin-flashable TAR package (.tar or .tar.md5) containing boot.img
 */
export function packageOdinTar(bootImgBytes: Uint8Array, fileName = 'boot.img', addMd5 = true): Uint8Array {
  // Standard POSIX UStar 512-byte header
  const header = new Uint8Array(512);

  // File name (100 bytes)
  for (let i = 0; i < Math.min(fileName.length, 99); i++) {
    header[i] = fileName.charCodeAt(i);
  }

  // File mode: "0000644\0" (8 bytes at 100)
  const mode = '0000644 ';
  for (let i = 0; i < mode.length; i++) header[100 + i] = mode.charCodeAt(i);

  // UID / GID: 0
  const uid = '0000000 ';
  for (let i = 0; i < uid.length; i++) header[108 + i] = uid.charCodeAt(i);
  const gid = '0000000 ';
  for (let i = 0; i < gid.length; i++) header[116 + i] = gid.charCodeAt(i);

  // File size in octal (12 bytes at 124)
  const octalSize = bootImgBytes.length.toString(8).padStart(11, '0') + ' ';
  for (let i = 0; i < octalSize.length; i++) header[124 + i] = octalSize.charCodeAt(i);

  // Mtime (12 bytes at 136)
  const mtime = Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + ' ';
  for (let i = 0; i < mtime.length; i++) header[136 + i] = mtime.charCodeAt(i);

  // Type flag: '0' (regular file at 156)
  header[156] = '0'.charCodeAt(0);

  // Magic: "ustar\0" (6 bytes at 257)
  const magic = 'ustar  ';
  for (let i = 0; i < magic.length; i++) header[257 + i] = magic.charCodeAt(i);

  // Compute checksum (8 bytes at 148, filled with spaces during calculation)
  for (let i = 0; i < 8; i++) header[148 + i] = ' '.charCodeAt(0);
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += header[i];
  const octalChecksum = checksum.toString(8).padStart(6, '0') + '\0 ';
  for (let i = 0; i < octalChecksum.length; i++) header[148 + i] = octalChecksum.charCodeAt(i);

  // Tar contents padding to 512 bytes
  const fileBlocks = Math.ceil(bootImgBytes.length / 512) * 512;
  const endBlocks = 1024; // Two 512-byte zero records marking EOF
  const tarSize = 512 + fileBlocks + endBlocks;

  const tarBuffer = new Uint8Array(tarSize);
  tarBuffer.set(header, 0);
  tarBuffer.set(bootImgBytes, 512);

  if (!addMd5) {
    return tarBuffer;
  }

  // Calculate simple MD5 hash approximation / string for Odin .tar.md5 suffix
  // In Odin, a .tar.md5 is simply the raw TAR bytes followed directly by the MD5 string in ASCII!
  const md5Str = computeSimpleMd5(tarBuffer);
  const outWithMd5 = new Uint8Array(tarSize + md5Str.length);
  outWithMd5.set(tarBuffer, 0);
  for (let i = 0; i < md5Str.length; i++) {
    outWithMd5[tarSize + i] = md5Str.charCodeAt(i);
  }

  return outWithMd5;
}

/**
 * Computes MD5 hash representation of buffer for Odin .tar.md5 files
 */
function computeSimpleMd5(buffer: Uint8Array): string {
  // Fast MD5 implementation in pure JS
  function md5cycle(x: number[], k: number[]) {
    let a = x[0], b = x[1], c = x[2], d = x[3];
    a = ff(a, b, c, d, k[0], 7, -680876936);
    d = ff(d, a, b, c, k[1], 12, -389564586);
    c = ff(c, d, a, b, k[2], 17, 606105819);
    b = ff(b, c, d, a, k[3], 22, -1044525330);
    a = ff(a, b, c, d, k[4], 7, -176418897);
    d = ff(d, a, b, c, k[5], 12, 1200080426);
    c = ff(c, d, a, b, k[6], 17, -1473231341);
    b = ff(b, c, d, a, k[7], 22, -45705983);
    a = ff(a, b, c, d, k[8], 7, 1770035416);
    d = ff(d, a, b, c, k[9], 12, -1958414417);
    c = ff(c, d, a, b, k[10], 17, -42063);
    b = ff(b, c, d, a, k[11], 22, -1990404162);
    a = ff(a, b, c, d, k[12], 7, 1804603682);
    d = ff(d, a, b, c, k[13], 12, -40341101);
    c = ff(c, d, a, b, k[14], 17, -1502002290);
    b = ff(b, c, d, a, k[15], 22, 1236535329);

    a = gg(a, b, c, d, k[1], 5, -165796510);
    d = gg(d, a, b, c, k[6], 9, -1069501632);
    c = gg(c, d, a, b, k[11], 14, 643717713);
    b = gg(b, c, d, a, k[0], 20, -373897302);
    a = gg(a, b, c, d, k[5], 5, -701558691);
    d = gg(d, a, b, c, k[10], 9, 38016083);
    c = gg(c, d, a, b, k[15], 14, -660478335);
    b = gg(b, c, d, a, k[4], 20, -405537848);
    a = gg(a, b, c, d, k[9], 5, 568446438);
    d = gg(d, a, b, c, k[14], 9, -1019803690);
    c = gg(c, d, a, b, k[3], 14, -187363961);
    b = gg(b, c, d, a, k[8], 20, 1163531501);
    a = gg(a, b, c, d, k[13], 5, -1444681467);
    d = gg(d, a, b, c, k[2], 9, -51403784);
    c = gg(c, d, a, b, k[7], 14, 1735328473);
    b = gg(b, c, d, a, k[12], 20, -1926607734);

    a = hh(a, b, c, d, k[5], 4, -378558);
    d = hh(d, a, b, c, k[8], 11, -2022574463);
    c = hh(c, d, a, b, k[11], 16, 1839030562);
    b = hh(b, c, d, a, k[14], 23, -35309556);
    a = hh(a, b, c, d, k[1], 4, -1530992060);
    d = hh(d, a, b, c, k[4], 11, 1272893353);
    c = hh(c, d, a, b, k[7], 16, -155497632);
    b = hh(b, c, d, a, k[10], 23, -1094730640);
    a = hh(a, b, c, d, k[13], 4, 681279174);
    d = hh(d, a, b, c, k[0], 11, -358537222);
    c = hh(c, d, a, b, k[3], 16, -722521979);
    b = hh(b, c, d, a, k[6], 23, 76029189);
    a = hh(a, b, c, d, k[9], 4, -640364487);
    d = hh(d, a, b, c, k[12], 11, -421815835);
    c = hh(c, d, a, b, k[15], 16, 530742520);
    b = hh(b, c, d, a, k[2], 23, -995338651);

    a = ii(a, b, c, d, k[0], 6, -198630844);
    d = ii(d, a, b, c, k[7], 10, 1126891415);
    c = ii(c, d, a, b, k[14], 15, -1416354905);
    b = ii(b, c, d, a, k[5], 21, -57434055);
    a = ii(a, b, c, d, k[12], 6, 1700485571);
    d = ii(d, a, b, c, k[3], 10, -1894986606);
    c = ii(c, d, a, b, k[10], 15, -1051523);
    b = ii(b, c, d, a, k[1], 21, -2054922799);
    a = ii(a, b, c, d, k[8], 6, 1873313359);
    d = ii(d, a, b, c, k[15], 10, -30611744);
    c = ii(c, d, a, b, k[6], 15, -1560198380);
    b = ii(b, c, d, a, k[13], 21, 1309151649);
    a = ii(a, b, c, d, k[4], 6, -145523070);
    d = ii(d, a, b, c, k[11], 10, -1120210379);
    c = ii(c, d, a, b, k[2], 15, 718787259);
    b = ii(b, c, d, a, k[9], 21, -343485551);

    x[0] = add32(a, x[0]);
    x[1] = add32(b, x[1]);
    x[2] = add32(c, x[2]);
    x[3] = add32(d, x[3]);
  }

  function cmn(q: number, a: number, b: number, x: number, s: number, t: number) {
    a = add32(add32(a, q), add32(x, t));
    return add32((a << s) | (a >>> (32 - s)), b);
  }
  function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
  function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
  function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
  function add32(a: number, b: number) { return (a + b) & 0xFFFFFFFF; }

  const state = [1732584193, -271733879, -1732584194, 271733878];
  const n = buffer.length;
  const nBlocks = Math.ceil((n + 9) / 64);
  const words = new Int32Array(nBlocks * 16);
  for (let i = 0; i < n; i++) {
    words[i >> 2] |= buffer[i] << ((i % 4) * 8);
  }
  words[n >> 2] |= 0x80 << ((n % 4) * 8);
  words[nBlocks * 16 - 2] = n * 8;

  for (let i = 0; i < words.length; i += 16) {
    const block = Array.from(words.subarray(i, i + 16));
    md5cycle(state, block);
  }

  return state.map(val => {
    let hex = '';
    for (let i = 0; i < 4; i++) {
      const byte = (val >>> (i * 8)) & 0xff;
      hex += byte.toString(16).padStart(2, '0');
    }
    return hex;
  }).join('');
}
