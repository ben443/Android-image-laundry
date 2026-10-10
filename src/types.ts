export type TabId = 'boot' | 'ramdisk' | 'dtb' | 'mainline' | 'samsung' | 'partitions' | 'flash' | 'logs';

export type LogLevel = 'info' | 'warn' | 'error' | 'success';

export interface LogEntry {
  id: string;
  timestamp: Date;
  message: string;
  level: LogLevel;
}

export interface PartitionInfo {
  id: string;
  name: string;
  size: string;
  sizeBytes?: number;
  minSizeBytes?: number;
  maxSizeBytes?: number;
  filesystem: 'ext4' | 'f2fs' | 'fat32' | 'erofs' | 'raw';
  isMountableRW: boolean;
  isMountedRW: boolean;
  isDynamic?: boolean;
  partitionType?: string;
  description?: string;
}

export interface BootImageInfo {
  headerVersion: number;
  osVersion: string;
  osPatchLevel: string;
  kernelSize: number | string;
  ramdiskSize: number | string;
  dtbSize?: number | string;
  pageSize: number;
  cmdline?: string;
  isGki: boolean;
  isSamsung?: boolean;
  hasSeAndroidFooter?: boolean;
}

export interface UploadedImage {
  name: string;
  sizeBytes: number;
  sizeFormatted: string;
  headerVersion: number;
  osVersion: string;
  osPatchLevel: string;
  pageSize: number;
  kernelSizeFormatted: string;
  ramdiskSizeFormatted: string;
  dtbSizeFormatted?: string;
  cmdline?: string;
  isGki: boolean;
  magicValid: boolean;
  uploadedAt: Date;
  hexPreview?: string;
  isSamsung?: boolean;
  seAndroidFooter?: 'SEANDROIDENFORCE' | 'NO KNOX' | null;
  rawBuffer?: ArrayBuffer;
  kernelBytes?: Uint8Array;
  ramdiskBytes?: Uint8Array;
  dtbBytes?: Uint8Array;
  targetRepackSizeBytes?: number;
}

export interface UnpackedFileItem {
  id: string;
  name: string;
  path: string;
  sizeFormatted: string;
  sizeBytes?: number;
  type: 'binary' | 'text' | 'json';
  content?: string;
  binaryData?: Uint8Array;
  updatedAt?: Date;
  description?: string;
  permissions?: string;
  isExecutable?: boolean;
}

export interface FdtProperty {
  name: string;
  value: string;
  rawType: 'string' | 'u32-array' | 'byte-array' | 'empty';
  rawBytes?: Uint8Array;
}

export interface FdtNode {
  name: string;
  path: string;
  properties: FdtProperty[];
  children: FdtNode[];
}

export interface SamsungRepackConfig {
  appendSeAndroidFooter: boolean;
  footerType: 'SEANDROIDENFORCE' | 'NO KNOX';
  generateOdinTar: boolean;
  generateMd5Checksum: boolean;
  tarFileName: string;
  selinuxPermissive: boolean;
  bypassKnoxWarrantyCmdline: boolean;
  loopMaxPart: boolean;
}

export interface MainlineBuildConfig {
  targetHeaderVersion: 2 | 3 | 4;
  kernelFormat: 'Image' | 'Image.gz';
  baseAddress: string;
  ramdiskOffset: string;
  tagsOffset: string;
  dtbOffset: string;
  pageSize: number;
  osVersion: string;
  osPatchLevel: string;
  cmdline: string;
  enableEarlycon: boolean;
  earlyconAddress: string;
  ignoreUnusedClocks: boolean;
  ignoreUnusedPowerDomains: boolean;
  appendSamsungFooter: boolean;
}
