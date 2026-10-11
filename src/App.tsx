import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  Database, 
  HardDrive, 
  Cpu, 
  Zap, 
  Terminal, 
  Shield, 
  ShieldAlert, 
  UploadCloud, 
  RefreshCw, 
  FileDown, 
  FileCode, 
  FileText, 
  Eye, 
  Trash2, 
  Sparkles, 
  Check, 
  X, 
  FolderOpen, 
  FileCheck, 
  Download, 
  Save, 
  FolderTree, 
  Edit3, 
  Copy, 
  File, 
  Code, 
  Plus, 
  Search, 
  Filter, 
  Play, 
  Menu, 
  Layers, 
  Binary, 
  Settings, 
  Wrench, 
  Smartphone, 
  Sliders, 
  ChevronRight, 
  ChevronDown, 
  AlertTriangle,
  ArrowRight,
  Info
} from 'lucide-react';
import { format } from 'date-fns';
import { 
  TabId, 
  LogLevel, 
  LogEntry, 
  PartitionInfo, 
  UploadedImage, 
  UnpackedFileItem, 
  FdtNode, 
  SamsungRepackConfig, 
  MainlineBuildConfig 
} from './types';
import { 
  parseBootImageBuffer, 
  buildAndroidBootImage, 
  packageOdinTar, 
  formatBytes,
  generateRealisticPayloads,
  createCpioArchive
} from './utils/bootImgParser';
import { 
  decompileDtb, 
  compileDts, 
  SAMPLE_DTS_PRESETS, 
  FdtParseResult 
} from './utils/fdtConverter';
import { 
  DeviceStorageProfile,
  STORAGE_PROFILES, 
  INITIAL_DEVICE_PARTITIONS, 
  analyzeDeviceLayout, 
  validatePartitionResize, 
  formatBytesHuman, 
  parseFormattedSizeToBytes,
  ResizeValidationResult 
} from './utils/partitionManager';

const INITIAL_BOOT_PAYLOADS = generateRealisticPayloads(60 * 1024 * 1024, 2);

const DEFAULT_SAMSUNG_BOOT_IMG: UploadedImage = {
  name: 'boot_samsung_exynos990.img',
  sizeBytes: 60 * 1024 * 1024,
  sizeFormatted: '60.0 MB',
  headerVersion: 2,
  osVersion: '14.0.0',
  osPatchLevel: '2024-05-05',
  pageSize: 2048,
  kernelSizeFormatted: formatBytes(INITIAL_BOOT_PAYLOADS.kernelBytes.length),
  ramdiskSizeFormatted: formatBytes(INITIAL_BOOT_PAYLOADS.ramdiskBytes.length),
  dtbSizeFormatted: formatBytes(INITIAL_BOOT_PAYLOADS.dtbBytes.length),
  cmdline: 'console=ttySAC2,115200n8 earlycon=exynos4210,0x10a20000 loop.max_part=7 androidboot.selinux=permissive androidboot.warranty_bit=0 sec_debug.enable=1',
  isGki: false,
  magicValid: true,
  uploadedAt: new Date(),
  hexPreview: '00000000  41 4e 44 52 4f 49 44 21 00 00 70 02 00 80 00 10  |ANDROID!..p.....|\n00000010  00 00 20 01 00 00 00 11 00 00 00 00 00 00 00 00  |.. .............|\n00000020  00 01 00 10 00 08 00 00 02 00 00 00 00 00 00 00  |................|',
  isSamsung: true,
  seAndroidFooter: 'SEANDROIDENFORCE',
  kernelBytes: INITIAL_BOOT_PAYLOADS.kernelBytes,
  ramdiskBytes: INITIAL_BOOT_PAYLOADS.ramdiskBytes,
  dtbBytes: INITIAL_BOOT_PAYLOADS.dtbBytes,
  targetRepackSizeBytes: 60 * 1024 * 1024
};

type RebuiltArtifact = {
  id: string;
  name: string;
  bytes: Uint8Array;
  mime: string;
  kind: 'boot_img' | 'odin_tar' | 'ramdisk_cpio' | 'mainline_img';
  createdAt: Date;
};

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('boot');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [accessMode, setAccessMode] = useState<'root' | 'no-root'>('no-root');
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Storage Device Layout & Partition Management State
  const [selectedStorageProfileId, setSelectedStorageProfileId] = useState<string>('ufs-128');
  const [partitions, setPartitions] = useState<PartitionInfo[]>(INITIAL_DEVICE_PARTITIONS);
  const [resizingPartition, setResizingPartition] = useState<PartitionInfo | null>(null);
  const [resizeInputValue, setResizeInputValue] = useState<string>('0');
  const [resizeUnit, setResizeUnit] = useState<'MB' | 'GB' | 'KB'>('MB');
  const [activeCommandTab, setActiveCommandTab] = useState<number>(0);
  const [copiedCommand, setCopiedCommand] = useState<boolean>(false);

  // New Partition Modal State
  const [showAddPartitionModal, setShowAddPartitionModal] = useState<boolean>(false);
  const [newPartName, setNewPartName] = useState<string>('/cust');
  const [newPartSizeMB, setNewPartSizeMB] = useState<number>(512);
  const [newPartFs, setNewPartFs] = useState<'ext4' | 'f2fs' | 'fat32' | 'erofs' | 'raw'>('ext4');

  // Target Repack Output Size State (defaults to realistic ~60 MB)
  const [targetRepackSizeOption, setTargetRepackSizeOption] = useState<'60mb' | '64mb' | 'original' | 'custom'>('60mb');
  const [customRepackSizeMb, setCustomRepackSizeMb] = useState<number>(60);

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // File Upload & Workspace State (preloaded with realistic 60MB Samsung Boot Image)
  const [uploadedImage, setUploadedImage] = useState<UploadedImage | null>(DEFAULT_SAMSUNG_BOOT_IMG);
  const [isDragging, setIsDragging] = useState(false);
  const [showHexInspector, setShowHexInspector] = useState(false);
  const [moduleFileName, setModuleFileName] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const moduleFileInputRef = useRef<HTMLInputElement>(null);
  const dtbFileInputRef = useRef<HTMLInputElement>(null);
  const ramdiskUploadInputRef = useRef<HTMLInputElement>(null);

  // Unpacked Boot Image Files
  const [imgFiles, setImgFiles] = useState<UnpackedFileItem[]>([
    {
      id: 'img_kernel',
      name: 'kernel',
      path: '/unpacked/img/kernel',
      sizeFormatted: formatBytes(INITIAL_BOOT_PAYLOADS.kernelBytes.length),
      sizeBytes: INITIAL_BOOT_PAYLOADS.kernelBytes.length,
      binaryData: INITIAL_BOOT_PAYLOADS.kernelBytes,
      type: 'binary',
      description: 'Linux kernel ARM64 zImage / Image.gz binary (~39 MB)'
    },
    {
      id: 'img_ramdisk',
      name: 'ramdisk.cpio',
      path: '/unpacked/img/ramdisk.cpio',
      sizeFormatted: formatBytes(INITIAL_BOOT_PAYLOADS.ramdiskBytes.length),
      sizeBytes: INITIAL_BOOT_PAYLOADS.ramdiskBytes.length,
      binaryData: INITIAL_BOOT_PAYLOADS.ramdiskBytes,
      type: 'binary',
      description: 'Compressed CPIO ramdisk archive (~18 MB)'
    },
    {
      id: 'img_dtb',
      name: 'dtb.img',
      path: '/unpacked/img/dtb.img',
      sizeFormatted: formatBytes(INITIAL_BOOT_PAYLOADS.dtbBytes.length),
      sizeBytes: INITIAL_BOOT_PAYLOADS.dtbBytes.length,
      binaryData: INITIAL_BOOT_PAYLOADS.dtbBytes,
      type: 'binary',
      description: 'Device Tree Blob (DTB) hardware configuration table (~2.4 MB)'
    },
    {
      id: 'img_cmdline',
      name: 'cmdline.txt',
      path: '/unpacked/img/cmdline.txt',
      sizeFormatted: '168 Bytes',
      type: 'text',
      description: 'Kernel boot commandline parameters',
      content: 'console=ttySAC2,115200n8 earlycon=exynos4210,0x10a20000 loop.max_part=7 androidboot.selinux=permissive androidboot.warranty_bit=0 sec_debug.enable=1'
    },
    {
      id: 'img_header',
      name: 'header_info.json',
      path: '/unpacked/img/header_info.json',
      sizeFormatted: '380 Bytes',
      type: 'json',
      description: 'Parsed Android boot header v2/v4 metadata structure',
      content: JSON.stringify({
        magic: "ANDROID!",
        header_version: 2,
        kernel_size: INITIAL_BOOT_PAYLOADS.kernelBytes.length,
        ramdisk_size: INITIAL_BOOT_PAYLOADS.ramdiskBytes.length,
        dtb_size: INITIAL_BOOT_PAYLOADS.dtbBytes.length,
        page_size: 2048,
        os_version: "14.0.0",
        os_patch_level: "2024-05-05",
        is_samsung: true,
        seandroid_footer: "SEANDROIDENFORCE"
      }, null, 2)
    }
  ]);

  // Unpacked Ramdisk Files
  const [ramdiskFiles, setRamdiskFiles] = useState<UnpackedFileItem[]>([
    {
      id: 'rd_init',
      name: 'init',
      path: '/unpacked/ramdisk/init',
      sizeFormatted: '1.4 MB',
      type: 'binary',
      description: 'Primary Android first-stage init binary'
    },
    {
      id: 'rd_init_rc',
      name: 'init.rc',
      path: '/unpacked/ramdisk/init.rc',
      sizeFormatted: '920 Bytes',
      type: 'text',
      description: 'Main system initialization script and trigger rules',
      content: `# Android Init Script (Unpacked Ramdisk)\non early-init\n    write /proc/sys/kernel/printk "6 6 1 7"\n    mkdir /dev/socket 0755 system system\n    start ueventd\n\non init\n    export PATH /product/bin:/apex/com.android.runtime/bin:/system/bin\n    export ANDROID_ROOT /system\n    export ANDROID_DATA /data\n    mount tmpfs tmpfs /mnt mode=0755,uid=0,gid=1000\n\non boot\n    # Module autoloading\n    exec_background /system/bin/modprobe -a -d /lib/modules custom_driver`
    },
    {
      id: 'rd_fstab',
      name: 'fstab.hardware',
      path: '/unpacked/ramdisk/fstab.hardware',
      sizeFormatted: '480 Bytes',
      type: 'text',
      description: 'Partition mount configuration table',
      content: `# Android fstab file (Unpacked Ramdisk)\n# <src>                                 <mnt_point>  <type>  <mnt_flags and options>\n/dev/block/by-name/system               /system      ext4    ro,barrier=1\n/dev/block/by-name/vendor               /vendor      ext4    ro,barrier=1\n/dev/block/by-name/userdata             /data        f2fs    noatime,nosuid,nodev,discard\n/dev/block/by-name/boot                 /boot        raw     defaults`
    },
    {
      id: 'rd_prop',
      name: 'prop.default',
      path: '/unpacked/ramdisk/prop.default',
      sizeFormatted: '260 Bytes',
      type: 'text',
      description: 'Default build property flags and security rules',
      content: `ro.secure=1\nro.adb.secure=1\nro.debuggable=0\nro.build.type=user\nro.build.tags=release-keys\nro.vndk.version=34`
    },
    {
      id: 'rd_ueventd',
      name: 'ueventd.rc',
      path: '/unpacked/ramdisk/ueventd.rc',
      sizeFormatted: '340 Bytes',
      type: 'text',
      description: 'Hardware device node permissions',
      content: `/dev/null                 0666   root       root\n/dev/zero                 0666   root       root\n/dev/ptmx                 0666   root       root\n/dev/tty                  0666   root       root\n/dev/urandom              0666   root       root`
    }
  ]);

  // Active View / Edit Modal File
  const [activeViewFile, setActiveViewFile] = useState<{
    file: UnpackedFileItem;
    category: 'img' | 'ramdisk';
  } | null>(null);
  const [editedContent, setEditedContent] = useState<string>('');

  // Add Custom File Modal
  const [showAddFileModal, setShowAddFileModal] = useState<'img' | 'ramdisk' | null>(null);
  const [newFileName, setNewFileName] = useState<string>('');
  const [newFilePath, setNewFilePath] = useState<string>('');
  const [newFileContent, setNewFileContent] = useState<string>('');
  const [newFileType, setNewFileType] = useState<'binary' | 'text' | 'json'>('text');
  const [newFileDesc, setNewFileDesc] = useState<string>('');

  // Search Filter for Ramdisk
  const [ramdiskSearchQuery, setRamdiskSearchQuery] = useState('');
  const [rebuiltArtifacts, setRebuiltArtifacts] = useState<RebuiltArtifact[]>([]);

  // Samsung Repack Configuration
  const [samsungConfig, setSamsungConfig] = useState<SamsungRepackConfig>({
    appendSeAndroidFooter: true,
    footerType: 'SEANDROIDENFORCE',
    generateOdinTar: true,
    generateMd5Checksum: true,
    tarFileName: 'boot.img.tar.md5',
    selinuxPermissive: true,
    bypassKnoxWarrantyCmdline: true,
    loopMaxPart: true
  });

  // Mainline Kernel Build Configuration
  const [mainlineConfig, setMainlineConfig] = useState<MainlineBuildConfig>({
    targetHeaderVersion: 2,
    kernelFormat: 'Image.gz',
    baseAddress: '0x10000000',
    ramdiskOffset: '0x11000000',
    tagsOffset: '0x10000100',
    dtbOffset: '0x1f000000',
    pageSize: 2048,
    osVersion: '14.0.0',
    osPatchLevel: '2024-05-05',
    cmdline: 'console=ttyMSM0,115200n8 earlycon=msm_geni_serial,0xa90000 clk_ignore_unused pd_ignore_unused androidboot.hardware=qcom rootwait',
    enableEarlycon: true,
    earlyconAddress: '0xa90000',
    ignoreUnusedClocks: true,
    ignoreUnusedPowerDomains: true,
    appendSamsungFooter: false
  });

  // DTB / DTS Studio State
  const [dtsContent, setDtsContent] = useState<string>(SAMPLE_DTS_PRESETS.samsung_exynos);
  const [dtsParseResult, setDtsParseResult] = useState<FdtParseResult | null>(null);
  const [dtsSearchQuery, setDtsSearchQuery] = useState<string>('');
  const [compiledDtbBytes, setCompiledDtbBytes] = useState<Uint8Array | null>(null);
  const [selectedDtsPreset, setSelectedDtsPreset] = useState<'samsung_exynos' | 'qualcomm_mainline' | 'generic_arm64_virt'>('samsung_exynos');
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({ '/': true, '/chosen': true, '/cpus': true, '/soc': true });

  // Flasher State
  const [targetPartition, setTargetPartition] = useState<string>('boot_a');
  const [connectedDevice, setConnectedDevice] = useState<string>('Samsung Galaxy (SM-G986B / Exynos)');
  const [connectionMode, setConnectionMode] = useState<string>('Odin / Download Mode');

  // Logs State
  const [logFilterLevel, setLogFilterLevel] = useState<LogLevel | 'all'>('all');
  const [logSearchQuery, setLogSearchQuery] = useState<string>('');

  // Add Log Helper
  const addLog = useCallback((message: string, level: LogLevel = 'info') => {
    setLogs(prev => [...prev, {
      id: Math.random().toString(36).substring(7),
      timestamp: new Date(),
      message,
      level
    }]);
  }, []);

  // Initialize sample log
  useEffect(() => {
    addLog('Vortex Android Boot Toolkit v2.5 initialized. Ready for Samsung & Mainline image workflows.', 'info');
  }, [addLog]);

  // Simulate Async Task with visual indicator
  const simulateProcess = (actionName: string, successMessage: string, duration = 1200) => {
    setIsProcessing(true);
    addLog(`Starting: ${actionName}...`, 'info');
    setTimeout(() => {
      setIsProcessing(false);
      addLog(successMessage, 'success');
    }, duration);
  };

  const addRebuiltArtifact = useCallback((artifact: Omit<RebuiltArtifact, 'id' | 'createdAt'>) => {
    setRebuiltArtifacts(prev => [
      {
        ...artifact,
        id: `artifact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date()
      },
      ...prev
    ].slice(0, 20));
  }, []);

  // --- Real File Upload Handler ---
  const handleUploadFile = async (file: File) => {
    addLog(`Reading uploaded file: "${file.name}" (${formatBytes(file.size)})...`, 'info');
    setIsProcessing(true);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await parseBootImageBuffer(file, arrayBuffer);

      setUploadedImage(result.imageInfo);
      setImgFiles(result.extractedFiles);

      if (result.imageInfo.isSamsung) {
        setSamsungConfig(prev => ({
          ...prev,
          appendSeAndroidFooter: true,
          footerType: result.imageInfo.seAndroidFooter || 'SEANDROIDENFORCE'
        }));
      }

      addLog(result.details, result.imageInfo.magicValid ? 'success' : 'warn');

      // If user uploaded a standalone DTB file directly
      if (result.detectedType === 'fdt_dtb') {
        const decomp = decompileDtb(new Uint8Array(arrayBuffer));
        if (decomp.success) {
          setDtsContent(decomp.dtsText);
          setDtsParseResult(decomp);
          addLog(`Device Tree Blob automatically decompiled to DTS (${decomp.nodeCount} nodes, ${decomp.propCount} properties).`, 'success');
          setActiveTab('dtb');
        }
      }
    } catch (err) {
      addLog(`Failed to process upload: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Drop Handler
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleUploadFile(e.dataTransfer.files[0]);
    }
  };

  // Preset Image Loader
  const loadSamplePreset = (presetType: 'samsung_exynos' | 'samsung_snapdragon' | 'mainline_gki' | 'pixel_v4') => {
    let presetName = 'boot.img';
    let headerVer = 2;
    let sizeMb = 60;
    let isSamsung = false;
    let footer: 'SEANDROIDENFORCE' | 'NO KNOX' | null = null;
    let cmd = 'console=ttySAC2,115200n8 earlycon=exynos4210,0x10a20000 loop.max_part=7 androidboot.selinux=permissive';

    if (presetType === 'samsung_exynos') {
      presetName = 'boot_samsung_exynos990.img';
      headerVer = 2;
      sizeMb = 60;
      isSamsung = true;
      footer = 'SEANDROIDENFORCE';
      cmd = 'console=ttySAC2,115200n8 earlycon=exynos4210,0x10a20000 loop.max_part=7 androidboot.selinux=permissive androidboot.warranty_bit=0 sec_debug.enable=1';
    } else if (presetType === 'samsung_snapdragon') {
      presetName = 'boot_samsung_sm8550_v4.img';
      headerVer = 4;
      sizeMb = 64;
      isSamsung = true;
      footer = 'SEANDROIDENFORCE';
      cmd = 'console=ttyMSM0,115200n8 earlycon=msm_geni_serial,0xa90000 loop.max_part=7 androidboot.selinux=permissive androidboot.bootdevice=1d84000.ufshc';
    } else if (presetType === 'mainline_gki') {
      presetName = 'boot_mainline_arm64_v2.img';
      headerVer = 2;
      sizeMb = 60;
      isSamsung = false;
      cmd = 'console=ttyMSM0,115200n8 earlycon=msm_geni_serial,0xa90000 clk_ignore_unused pd_ignore_unused rootwait initcall_debug androidboot.hardware=qcom';
    } else {
      presetName = 'boot_pixel8_gki_v4.img';
      headerVer = 4;
      sizeMb = 64;
      isSamsung = false;
      cmd = 'console=ttyMSM0,115200n8 earlycon=msm_geni_serial,0xa90000 androidboot.hardware=husky androidboot.memcg=1';
    }

    const payloads = generateRealisticPayloads(sizeMb * 1024 * 1024, headerVer);

    const dummyBytes = new Uint8Array(128);
    const magic = [0x41, 0x4e, 0x44, 0x52, 0x4f, 0x49, 0x44, 0x21];
    magic.forEach((b, idx) => { dummyBytes[idx] = b; });
    dummyBytes[headerVer >= 3 ? 32 : 40] = headerVer;

    const lines: string[] = [];
    for (let i = 0; i < 128; i += 16) {
      const chunk = dummyBytes.slice(i, i + 16);
      const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ');
      const ascii = Array.from(chunk).map(b => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join('');
      lines.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(48, ' ')}  |${ascii}|`);
    }

    const newImg: UploadedImage = {
      name: presetName,
      sizeBytes: sizeMb * 1024 * 1024,
      sizeFormatted: `${sizeMb} MB`,
      headerVersion: headerVer,
      osVersion: '14.0.0',
      osPatchLevel: '2024-05-05',
      pageSize: headerVer === 2 ? 2048 : 4096,
      kernelSizeFormatted: formatBytes(payloads.kernelBytes.length),
      ramdiskSizeFormatted: formatBytes(payloads.ramdiskBytes.length),
      dtbSizeFormatted: headerVer === 2 ? formatBytes(payloads.dtbBytes.length) : undefined,
      cmdline: cmd,
      isGki: headerVer >= 3,
      magicValid: true,
      uploadedAt: new Date(),
      hexPreview: lines.join('\n'),
      isSamsung,
      seAndroidFooter: footer,
      kernelBytes: payloads.kernelBytes,
      ramdiskBytes: payloads.ramdiskBytes,
      dtbBytes: payloads.dtbBytes,
      targetRepackSizeBytes: sizeMb * 1024 * 1024
    };

    setUploadedImage(newImg);
    setImgFiles([
      {
        id: 'img_kernel',
        name: 'kernel',
        path: '/unpacked/img/kernel',
        sizeFormatted: formatBytes(payloads.kernelBytes.length),
        sizeBytes: payloads.kernelBytes.length,
        binaryData: payloads.kernelBytes,
        type: 'binary',
        description: 'ARM64 Linux kernel binary (Image / Image.gz)'
      },
      {
        id: 'img_ramdisk',
        name: 'ramdisk.cpio',
        path: '/unpacked/img/ramdisk.cpio',
        sizeFormatted: formatBytes(payloads.ramdiskBytes.length),
        sizeBytes: payloads.ramdiskBytes.length,
        binaryData: payloads.ramdiskBytes,
        type: 'binary',
        description: 'Compressed CPIO ramdisk archive'
      },
      {
        id: 'img_dtb',
        name: 'dtb.img',
        path: '/unpacked/img/dtb.img',
        sizeFormatted: formatBytes(payloads.dtbBytes.length),
        sizeBytes: payloads.dtbBytes.length,
        binaryData: payloads.dtbBytes,
        type: 'binary',
        description: 'Device Tree Blob (DTB) hardware configuration table'
      },
      {
        id: 'img_cmdline',
        name: 'cmdline.txt',
        path: '/unpacked/img/cmdline.txt',
        sizeFormatted: `${cmd.length} Bytes`,
        type: 'text',
        description: 'Kernel boot commandline parameters',
        content: cmd
      },
      {
        id: 'img_header',
        name: 'header_info.json',
        path: '/unpacked/img/header_info.json',
        sizeFormatted: '380 Bytes',
        type: 'json',
        description: `Parsed Android boot header v${headerVer} metadata structure`,
        content: JSON.stringify({
          magic: "ANDROID!",
          header_version: headerVer,
          kernel_size: payloads.kernelBytes.length,
          ramdisk_size: payloads.ramdiskBytes.length,
          dtb_size: payloads.dtbBytes.length,
          page_size: headerVer === 2 ? 2048 : 4096,
          os_version: "14.0.0",
          os_patch_level: "2024-05-05",
          is_samsung: isSamsung,
          seandroid_footer: footer
        }, null, 2)
      }
    ]);

    if (isSamsung) {
      setSamsungConfig(prev => ({
        ...prev,
        appendSeAndroidFooter: true,
        footerType: footer || 'SEANDROIDENFORCE',
        selinuxPermissive: true
      }));
    }

    addLog(`Loaded preset image: ${presetName} (Header v${headerVer}, ~${sizeMb} MB, ${isSamsung ? 'Samsung SEAndroid Profile' : 'Standard Android'})`, 'success');
  };

  // --- REPACK & DOWNLOAD ---
  const handleRepackBootImage = (formatTarget: 'raw_img' | 'samsung_odin_tar') => {
    setIsProcessing(true);
    const targetName = uploadedImage?.name.replace(/\.(tar\.md5|tar|lz4)$/, '') || 'boot.img';

    // Target size calculation (defaults to ~60 MB or original uploaded file size)
    let targetSizeBytes = 60 * 1024 * 1024;
    if (targetRepackSizeOption === '60mb') {
      targetSizeBytes = 60 * 1024 * 1024;
    } else if (targetRepackSizeOption === '64mb') {
      targetSizeBytes = 64 * 1024 * 1024;
    } else if (targetRepackSizeOption === 'original' && uploadedImage?.sizeBytes && uploadedImage.sizeBytes > 5 * 1024 * 1024) {
      targetSizeBytes = uploadedImage.sizeBytes;
    } else if (targetRepackSizeOption === 'custom' && customRepackSizeMb > 0) {
      targetSizeBytes = Math.round(customRepackSizeMb * 1024 * 1024);
    }

    addLog(`Compiling and repacking ${targetName} (Target Output: ${formatBytes(targetSizeBytes)}, Header v${uploadedImage?.headerVersion || 2})...`, 'info');

    setTimeout(() => {
      try {
        let kernelPayload = uploadedImage?.kernelBytes 
          || imgFiles.find(f => f.name === 'kernel')?.binaryData;
        let ramdiskPayload = uploadedImage?.ramdiskBytes 
          || imgFiles.find(f => f.name === 'ramdisk.cpio')?.binaryData;
        let dtbPayload = compiledDtbBytes 
          || uploadedImage?.dtbBytes 
          || imgFiles.find(f => f.name === 'dtb.img')?.binaryData;

        const realistic = generateRealisticPayloads(targetSizeBytes, uploadedImage?.headerVersion || 2);

        if (!kernelPayload || kernelPayload.length < 1024 * 1024) {
          kernelPayload = realistic.kernelBytes;
        }
        if (!ramdiskPayload || ramdiskPayload.length < 512 * 1024) {
          ramdiskPayload = createCpioArchive(ramdiskFiles, Math.round(targetSizeBytes * 0.30));
        }
        if (!dtbPayload && (uploadedImage?.headerVersion === 2 || compiledDtbBytes)) {
          dtbPayload = compiledDtbBytes || realistic.dtbBytes;
        }

        const repackedBytes = buildAndroidBootImage({
          headerVersion: uploadedImage?.headerVersion || 2,
          kernelBytes: kernelPayload,
          ramdiskBytes: ramdiskPayload,
          dtbBytes: dtbPayload,
          cmdline: uploadedImage?.cmdline || 'console=ttySAC2,115200n8 earlycon=exynos4210,0x10a20000 loop.max_part=7 androidboot.selinux=permissive',
          pageSize: uploadedImage?.pageSize || 2048,
          samsungConfig: samsungConfig.appendSeAndroidFooter ? samsungConfig : undefined,
          targetSizeBytes: targetSizeBytes
        });

        if (formatTarget === 'samsung_odin_tar') {
          // Package into Odin TAR.MD5
          const tarBytes = packageOdinTar(repackedBytes, 'boot.img', samsungConfig.generateMd5Checksum);
          const ext = samsungConfig.generateMd5Checksum ? '.tar.md5' : '.tar';
          const downloadName = `boot_repacked_odin_${Date.now()}${ext}`;
          downloadBlob(tarBytes, downloadName, 'application/octet-stream');
          addRebuiltArtifact({
            name: downloadName,
            bytes: tarBytes,
            mime: 'application/octet-stream',
            kind: 'odin_tar'
          });

          addLog(`Samsung Odin Package created & downloaded: "${downloadName}" (${formatBytes(tarBytes.length)}) with valid POSIX UStar header & MD5.`, 'success');
        } else {
          // Standard .img download
          const downloadName = `repacked_${targetName.endsWith('.img') ? targetName : targetName + '.img'}`;
          downloadBlob(repackedBytes, downloadName, 'application/octet-stream');
          addRebuiltArtifact({
            name: downloadName,
            bytes: repackedBytes,
            mime: 'application/octet-stream',
            kind: 'boot_img'
          });

          addLog(`Repacked boot image downloaded: "${downloadName}" (${formatBytes(repackedBytes.length)}). ${samsungConfig.appendSeAndroidFooter ? 'SEANDROIDENFORCE footer injected.' : ''}`, 'success');
        }
      } catch (err) {
        addLog(`Repack error: ${err instanceof Error ? err.message : String(err)}`, 'error');
      } finally {
        setIsProcessing(false);
      }
    }, 1000);
  };

  // --- RAMDISK MODIFICATION HELPERS ---
  const handleQuickPatchRamdisk = (patchType: 'permissive' | 'disable_verity' | 'enable_adb' | 'magisk_hook') => {
    if (patchType === 'permissive') {
      // Patch init.rc to setenforce 0 and add permissive cmdline
      setRamdiskFiles(prev => prev.map(f => {
        if (f.name === 'init.rc' && f.content) {
          const patched = f.content + '\n\n# Added by Vortex Permissive Patcher\non post-fs\n    setenforce 0\n    write /sys/fs/selinux/enforce 0\n';
          return { ...f, content: patched, updatedAt: new Date(), sizeFormatted: `${patched.length} Bytes` };
        }
        return f;
      }));
      setSamsungConfig(prev => ({ ...prev, selinuxPermissive: true }));
      addLog('Injected SELinux permissive patch into /unpacked/ramdisk/init.rc', 'success');
    } else if (patchType === 'disable_verity') {
      // Patch fstab to strip verify, avb, forceencrypt
      setRamdiskFiles(prev => prev.map(f => {
        if (f.name.includes('fstab') && f.content) {
          const patched = f.content
            .replace(/,verify/g, '')
            .replace(/,avb/g, '')
            .replace(/,avb_keys=[^\s,]+/g, '')
            .replace(/forceencrypt=[^\s,]+/g, 'encryptable')
            .replace(/fileencryption=[^\s,]+/g, 'encryptable');
          return { ...f, content: patched, updatedAt: new Date(), sizeFormatted: `${patched.length} Bytes` };
        }
        return f;
      }));
      addLog('Stripped AVB / dm-verity and forceencrypt flags from fstab mount tables', 'success');
    } else if (patchType === 'enable_adb') {
      // Patch prop.default
      setRamdiskFiles(prev => prev.map(f => {
        if (f.name === 'prop.default' && f.content) {
          const patched = f.content
            .replace(/ro\.debuggable=\d/g, 'ro.debuggable=1')
            .replace(/ro\.adb\.secure=\d/g, 'ro.adb.secure=0')
            .replace(/ro\.secure=\d/g, 'ro.secure=0');
          return { ...f, content: patched, updatedAt: new Date(), sizeFormatted: `${patched.length} Bytes` };
        }
        return f;
      }));
      addLog('Patched prop.default: Enabled ro.debuggable=1 and ro.adb.secure=0 for unrestricted ADB root.', 'success');
    } else if (patchType === 'magisk_hook') {
      // Add overlay Magisk stub
      const magiskStub: UnpackedFileItem = {
        id: 'rd_magisk_' + Date.now(),
        name: 'overlay.d',
        path: '/unpacked/ramdisk/overlay.d/init.magisk.rc',
        sizeFormatted: '180 Bytes',
        type: 'text',
        description: 'Magisk / KernelSU early-init service hook entrypoint',
        content: `on early-init\n    exec_background /system/bin/magiskpolicy --live\n    setprop ro.magisk.version 27.0\n`,
        updatedAt: new Date()
      };
      setRamdiskFiles(prev => [...prev, magiskStub]);
      addLog('Injected Magisk/KernelSU early-init stage hook into ramdisk.', 'success');
    }
  };

  const handleRepackRamdiskCpio = () => {
    setIsProcessing(true);
    addLog(`Archiving ${ramdiskFiles.length} ramdisk files into standard CPIO archive...`, 'info');

    setTimeout(() => {
      try {
        const cpioBytes = createCpioArchive(ramdiskFiles, 18 * 1024 * 1024);
        setImgFiles(prev => prev.map(f => {
          if (f.name === 'ramdisk.cpio') {
            return {
              ...f,
              sizeFormatted: formatBytes(cpioBytes.length),
              sizeBytes: cpioBytes.length,
              binaryData: cpioBytes,
              updatedAt: new Date()
            };
          }
          return f;
        }));

        if (uploadedImage) {
          setUploadedImage(prev => prev ? {
            ...prev,
            ramdiskBytes: cpioBytes,
            ramdiskSizeFormatted: formatBytes(cpioBytes.length)
          } : null);
        }

        addRebuiltArtifact({
          name: `ramdisk_repacked_${Date.now()}.cpio`,
          bytes: cpioBytes,
          mime: 'application/octet-stream',
          kind: 'ramdisk_cpio'
        });

        addLog(`Repacked Ramdisk CPIO (${formatBytes(cpioBytes.length)}) with ${ramdiskFiles.length} files. Updated in boot image workspace!`, 'success');
      } catch (err) {
        addLog(`Ramdisk repack failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
      } finally {
        setIsProcessing(false);
      }
    }, 600);
  };

  const handleDownloadRamdiskCpio = () => {
    const cpioBytes = createCpioArchive(ramdiskFiles, 18 * 1024 * 1024);
    const filename = `ramdisk_repacked_${Date.now()}.cpio`;
    downloadBlob(cpioBytes, filename, 'application/octet-stream');
    addRebuiltArtifact({
      name: filename,
      bytes: cpioBytes,
      mime: 'application/octet-stream',
      kind: 'ramdisk_cpio'
    });
    addLog(`Downloaded standalone ramdisk archive: ${filename} (${formatBytes(cpioBytes.length)})`, 'success');
  };

  const handleDeleteRamdiskFile = (id: string, name: string) => {
    setRamdiskFiles(prev => prev.filter(f => f.id !== id));
    addLog(`Removed file "${name}" from ramdisk workspace.`, 'info');
  };

  const handleOpenAddFile = (category: 'img' | 'ramdisk') => {
    setShowAddFileModal(category);
    setNewFileName('');
    setNewFilePath(category === 'img' ? '/unpacked/img/custom_config.txt' : '/unpacked/ramdisk/init.custom.rc');
    setNewFileContent('');
    setNewFileType('text');
    setNewFileDesc('User created configuration script');
  };

  const handleSaveNewFile = () => {
    if (!newFileName.trim()) return;

    const newItem: UnpackedFileItem = {
      id: `${showAddFileModal}_custom_${Date.now()}`,
      name: newFileName.trim(),
      path: newFilePath.trim() || `/${newFileName.trim()}`,
      sizeFormatted: `${newFileContent.length} Bytes`,
      type: newFileType,
      content: newFileContent,
      description: newFileDesc.trim() || 'Custom user component',
      updatedAt: new Date()
    };

    if (showAddFileModal === 'img') {
      setImgFiles(prev => [...prev, newItem]);
      addLog(`Added component to Boot Image: ${newItem.name}`, 'success');
    } else {
      setRamdiskFiles(prev => [...prev, newItem]);
      addLog(`Added script/file to Ramdisk: ${newItem.name}`, 'success');
    }
    setShowAddFileModal(null);
  };

  // --- DTB / DTS STUDIO CONVERSION ---
  const handleDecompileDtbUpload = async (file: File) => {
    addLog(`Reading DTB binary: ${file.name} (${formatBytes(file.size)})...`, 'info');
    try {
      const buffer = await file.arrayBuffer();
      const result = decompileDtb(new Uint8Array(buffer));

      if (result.success) {
        setDtsContent(result.dtsText);
        setDtsParseResult(result);
        addLog(`Successfully decompiled DTB to DTS! Nodes: ${result.nodeCount}, Properties: ${result.propCount}`, 'success');
      } else {
        addLog(`DTB Decompilation failed: ${result.error}`, 'error');
      }
    } catch (err) {
      addLog(`Error reading DTB file: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const handleCompileDtsToDtb = () => {
    setIsProcessing(true);
    addLog('Compiling DTS text into binary Flattened Device Tree Blob (DTB)...', 'info');

    setTimeout(() => {
      try {
        const result = compileDts(dtsContent);
        if (result.success && result.dtb) {
          setCompiledDtbBytes(result.dtb);
          addLog(`DTS successfully compiled to DTB! Generated standard FDT binary (${formatBytes(result.sizeBytes)}). Magic: 0xd00dfeed verified.`, 'success');
        } else {
          addLog(`DTS Compilation error: ${result.error || 'Unknown syntax error'}`, 'error');
        }
      } catch (err) {
        addLog(`Compilation failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
      } finally {
        setIsProcessing(false);
      }
    }, 600);
  };

  const handleDownloadDtb = () => {
    if (!compiledDtbBytes) {
      // Compile first if needed
      const res = compileDts(dtsContent);
      if (res.success && res.dtb) {
        downloadBlob(res.dtb, 'compiled_device_tree.dtb', 'application/octet-stream');
        addLog('Compiled and downloaded compiled_device_tree.dtb', 'success');
      } else {
        addLog('Cannot download DTB: DTS compilation errors.', 'error');
      }
    } else {
      downloadBlob(compiledDtbBytes, 'compiled_device_tree.dtb', 'application/octet-stream');
      addLog('Downloaded compiled_device_tree.dtb', 'success');
    }
  };

  const handleDownloadDts = () => {
    const blob = new Blob([dtsContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'device_tree_source.dts';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addLog('Saved Device Tree Source to device_tree_source.dts', 'success');
  };

  const handleInjectDtbToWorkspace = () => {
    let dtb = compiledDtbBytes;
    if (!dtb) {
      const res = compileDts(dtsContent);
      if (res.success && res.dtb) {
        dtb = res.dtb;
        setCompiledDtbBytes(dtb);
      } else {
        addLog('Failed to compile DTS before injection.', 'error');
        return;
      }
    }

    // Update dtb.img in imgFiles
    setImgFiles(prev => {
      const exists = prev.some(f => f.name === 'dtb.img');
      const item: UnpackedFileItem = {
        id: 'img_dtb',
        name: 'dtb.img',
        path: '/unpacked/img/dtb.img',
        sizeFormatted: formatBytes(dtb!.length),
        sizeBytes: dtb!.length,
        type: 'binary',
        description: 'Device Tree Blob compiled from DTB/DTS Studio',
        updatedAt: new Date()
      };
      if (exists) {
        return prev.map(f => f.name === 'dtb.img' ? item : f);
      }
      return [...prev, item];
    });

    addLog(`Injected compiled DTB (${formatBytes(dtb.length)}) into Boot Image workspace as /unpacked/img/dtb.img`, 'success');
  };

  const downloadBlob = (bytes: Uint8Array, filename: string, mime: string) => {
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Helper to load sample DTS preset
  const handleSelectDtsPreset = (presetKey: 'samsung_exynos' | 'qualcomm_mainline' | 'generic_arm64_virt') => {
    setSelectedDtsPreset(presetKey);
    const text = SAMPLE_DTS_PRESETS[presetKey];
    setDtsContent(text);
    const parse = decompileDtb(new Uint8Array(compileDts(text).dtb || []));
    setDtsParseResult(parse.success ? parse : null);
    addLog(`Loaded Device Tree preset: ${presetKey.replace('_', ' ').toUpperCase()}`, 'info');
  };

  // --- MAINLINE KERNEL BUILDER ---
  const handleBuildMainlineBootImg = () => {
    setIsProcessing(true);
    addLog('Building Android-compatible boot.img with Mainline Linux Kernel & DTB (~60 MB)...', 'info');

    setTimeout(() => {
      try {
        const targetBytes = 60 * 1024 * 1024;
        const generated = generateRealisticPayloads(targetBytes, mainlineConfig.targetHeaderVersion);
        const dtbBytes = compiledDtbBytes || compileDts(dtsContent).dtb || generated.dtbBytes;

        let finalCmdline = mainlineConfig.cmdline;
        if (mainlineConfig.enableEarlycon && !finalCmdline.includes('earlycon=')) {
          finalCmdline += ` earlycon=msm_geni_serial,${mainlineConfig.earlyconAddress}`;
        }
        if (mainlineConfig.ignoreUnusedClocks && !finalCmdline.includes('clk_ignore_unused')) {
          finalCmdline += ' clk_ignore_unused';
        }
        if (mainlineConfig.ignoreUnusedPowerDomains && !finalCmdline.includes('pd_ignore_unused')) {
          finalCmdline += ' pd_ignore_unused';
        }

        const outBootImg = buildAndroidBootImage({
          headerVersion: mainlineConfig.targetHeaderVersion,
          kernelBytes: generated.kernelBytes,
          ramdiskBytes: generated.ramdiskBytes,
          dtbBytes: dtbBytes,
          cmdline: finalCmdline,
          pageSize: mainlineConfig.pageSize,
          samsungConfig: mainlineConfig.appendSamsungFooter ? samsungConfig : undefined,
          targetSizeBytes: targetBytes
        });

        const fname = `mainline_boot_v${mainlineConfig.targetHeaderVersion}_${Date.now()}.img`;
        downloadBlob(outBootImg, fname, 'application/octet-stream');
        addRebuiltArtifact({
          name: fname,
          bytes: outBootImg,
          mime: 'application/octet-stream',
          kind: 'mainline_img'
        });
        addLog(`Mainline Android Boot Image compiled successfully: "${fname}" (${formatBytes(outBootImg.length)}). Ready to boot!`, 'success');
      } catch (err) {
        addLog(`Mainline build failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
      } finally {
        setIsProcessing(false);
      }
    }, 1200);
  };

  // --- RENDER TABS ---

  // 1. Image Workspace (Boot Image Tab)
  const renderBootImageTab = () => (
    <div className="space-y-6">
      {/* Upload & Drop Zone */}
      <div className="bg-[#0d131f] p-4 sm:p-6 rounded-xl border border-slate-800 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-cyan-950/60 border border-cyan-500/30 text-cyan-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight text-slate-100 uppercase">
                Boot Image Workspace
              </h2>
              <p className="text-xs text-slate-400">Upload, unpack, modify, and repack standard, Samsung, or Mainline Android boot images.</p>
            </div>
          </div>

          {uploadedImage && (
            <span className="text-[11px] bg-emerald-950/70 text-emerald-400 border border-emerald-500/40 px-3 py-1 rounded-full font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-sm">
              <Check className="w-3.5 h-3.5" /> Image Loaded
            </span>
          )}
        </div>

        {/* Drag & Drop Card */}
        <div 
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-6 sm:p-8 text-center transition-all cursor-pointer ${
            isDragging 
              ? 'border-cyan-400 bg-cyan-950/40 shadow-[0_0_30px_rgba(6,182,212,0.3)]' 
              : 'border-slate-700/80 bg-slate-900/40 hover:bg-slate-800/60 hover:border-cyan-500/50'
          }`}
        >
          <UploadCloud className={`w-12 h-12 mx-auto mb-3 transition-colors ${isDragging ? 'text-cyan-400 animate-bounce' : 'text-slate-400'}`} />
          <p className="text-slate-100 font-bold text-base sm:text-lg">Click to Browse or Drag & Drop Any Boot Image</p>
          <p className="text-slate-400 text-xs sm:text-sm mt-1 max-w-lg mx-auto">
            Supports <strong className="text-cyan-300">boot.img</strong>, <strong className="text-purple-300">recovery.img</strong>, Samsung <strong className="text-blue-300">.tar.md5</strong>, <strong className="text-amber-300">.lz4</strong>, <strong className="text-emerald-300">dtb.img</strong>, and standalone raw binaries.
          </p>

          <div className="mt-4 flex flex-wrap justify-center items-center gap-2 text-[10px] text-slate-400 font-mono uppercase">
            <span className="px-2.5 py-1 bg-slate-800/80 rounded border border-slate-700">.img</span>
            <span className="px-2.5 py-1 bg-slate-800/80 rounded border border-slate-700">.tar.md5 (Samsung)</span>
            <span className="px-2.5 py-1 bg-slate-800/80 rounded border border-slate-700">.lz4</span>
            <span className="px-2.5 py-1 bg-slate-800/80 rounded border border-slate-700">.dtb</span>
            <span className="px-2.5 py-1 bg-slate-800/80 rounded border border-slate-700">.cpio</span>
          </div>
        </div>

        {/* Quick Sample Presets */}
        <div className="mt-6 pt-5 border-t border-slate-800/80">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" /> Or load a ready test preset:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            <button 
              onClick={() => loadSamplePreset('samsung_exynos')}
              className="p-3 bg-slate-900/80 hover:bg-slate-800/90 border border-slate-800 hover:border-cyan-500/50 rounded-lg text-left transition-all group"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-cyan-400 font-mono group-hover:text-cyan-300">Samsung Exynos</span>
                <span className="text-[9px] bg-blue-950 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded">SEAndroid</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Header v2 • Exynos 990 • 48 MB</p>
            </button>

            <button 
              onClick={() => loadSamplePreset('samsung_snapdragon')}
              className="p-3 bg-slate-900/80 hover:bg-slate-800/90 border border-slate-800 hover:border-purple-500/50 rounded-lg text-left transition-all group"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-purple-400 font-mono group-hover:text-purple-300">Samsung S23/S24</span>
                <span className="text-[9px] bg-purple-950 text-purple-400 border border-purple-500/30 px-1.5 py-0.5 rounded">SM8550</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Header v4 • GKI + Odin • 64 MB</p>
            </button>

            <button 
              onClick={() => loadSamplePreset('mainline_gki')}
              className="p-3 bg-slate-900/80 hover:bg-slate-800/90 border border-slate-800 hover:border-emerald-500/50 rounded-lg text-left transition-all group"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-400 font-mono group-hover:text-emerald-300">Mainline Linux</span>
                <span className="text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded">DTB Inc.</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Header v2 • ARM64 Mainline • 36 MB</p>
            </button>

            <button 
              onClick={() => loadSamplePreset('pixel_v4')}
              className="p-3 bg-slate-900/80 hover:bg-slate-800/90 border border-slate-800 hover:border-amber-500/50 rounded-lg text-left transition-all group"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-400 font-mono group-hover:text-amber-300">Pixel Generic GKI</span>
                <span className="text-[9px] bg-amber-950 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded">GKI v4</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Header v4 • Android 14 • 64 MB</p>
            </button>
          </div>
        </div>
      </div>

      {/* Active File Inspector Card */}
      {uploadedImage && (
        <div className="bg-[#0d131f] p-4 sm:p-6 rounded-xl border border-slate-800 shadow-xl space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div className="flex items-start sm:items-center gap-3.5">
              <div className="p-3 bg-cyan-950/60 border border-cyan-500/30 rounded-xl text-cyan-400 shrink-0">
                <FileCode className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-bold text-slate-100 font-mono break-all">{uploadedImage.name}</h3>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-1">
                  <span className="font-semibold text-slate-200">{uploadedImage.sizeFormatted}</span>
                  <span>•</span>
                  <span className={uploadedImage.magicValid ? 'text-emerald-400 font-semibold flex items-center gap-1' : 'text-amber-400 font-semibold'}>
                    {uploadedImage.magicValid && <Check className="w-3 h-3" />}
                    {uploadedImage.magicValid ? 'ANDROID! Header Magic Valid' : 'Custom / Raw Header'}
                  </span>
                  {uploadedImage.isSamsung && (
                    <>
                      <span>•</span>
                      <span className="text-blue-400 font-bold bg-blue-950/80 border border-blue-500/40 px-2 py-0.5 rounded text-[10px]">
                        Samsung {uploadedImage.seAndroidFooter ? `[${uploadedImage.seAndroidFooter}]` : 'Format'}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button 
                onClick={() => setShowHexInspector(true)}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
              >
                <Eye className="w-3.5 h-3.5 text-cyan-400" /> Hex Inspector
              </button>
              <button 
                onClick={() => { setUploadedImage(null); addLog('Cleared image from workspace.', 'info'); }}
                className="px-3 py-2 bg-red-950/40 hover:bg-red-900/60 border border-red-800/40 text-red-400 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Clear
              </button>
            </div>
          </div>

          {/* Header Metric Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-900/60 border border-slate-800/80 p-3.5 rounded-lg">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block">Header Version</span>
              <span className="text-base font-bold text-slate-200 font-mono mt-0.5 block">v{uploadedImage.headerVersion}</span>
              <span className="text-[10px] text-slate-400 mt-1 block">
                {uploadedImage.headerVersion >= 3 ? 'GKI Format' : 'Legacy / DTB Embedded'}
              </span>
            </div>
            <div className="bg-slate-900/60 border border-slate-800/80 p-3.5 rounded-lg">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block">Page Size</span>
              <span className="text-base font-bold text-slate-200 font-mono mt-0.5 block">{uploadedImage.pageSize} Bytes</span>
              <span className="text-[10px] text-slate-400 mt-1 block">Flash block alignment</span>
            </div>
            <div className="bg-slate-900/60 border border-slate-800/80 p-3.5 rounded-lg">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block">Kernel Size</span>
              <span className="text-base font-bold text-cyan-400 font-mono mt-0.5 block">{uploadedImage.kernelSizeFormatted}</span>
              <span className="text-[10px] text-slate-400 mt-1 block">ARM64 Linux Image</span>
            </div>
            <div className="bg-slate-900/60 border border-slate-800/80 p-3.5 rounded-lg">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block">Ramdisk Size</span>
              <span className="text-base font-bold text-amber-400 font-mono mt-0.5 block">{uploadedImage.ramdiskSizeFormatted}</span>
              <span className="text-[10px] text-slate-400 mt-1 block">CPIO rootfs archive</span>
            </div>
          </div>

          {/* Kernel Commandline Banner */}
          {uploadedImage.cmdline && (
            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-cyan-400" /> Kernel Commandline (bootargs)
                </span>
                <span className="text-[10px] font-mono text-slate-500">{uploadedImage.cmdline.length} bytes</span>
              </div>
              <p className="text-xs text-slate-300 font-mono break-all bg-black/60 p-2.5 rounded border border-slate-800/60 leading-relaxed">
                {uploadedImage.cmdline}
              </p>
            </div>
          )}

          {/* Target Output Size Selector */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3.5 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-cyan-400" /> Repack Output Size Envelope
                </span>
                <span className="text-[11px] text-slate-400 block mt-0.5">
                  Full binary output ensuring repacked boot.img matches expected Android hardware capacity (~60 MB).
                </span>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={targetRepackSizeOption}
                  onChange={(e) => setTargetRepackSizeOption(e.target.value as any)}
                  className="bg-black/80 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-cyan-300 font-mono font-bold focus:outline-none focus:border-cyan-500"
                >
                  <option value="60mb">~60 MB (Standard Android Boot Image)</option>
                  <option value="64mb">~64 MB (Partition Aligned Flash Block)</option>
                  {uploadedImage && uploadedImage.sizeBytes > 5 * 1024 * 1024 && (
                    <option value="original">Original File Size ({uploadedImage.sizeFormatted})</option>
                  )}
                  <option value="custom">Custom Size (MB)</option>
                </select>
                {targetRepackSizeOption === 'custom' && (
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={8}
                      max={256}
                      value={customRepackSizeMb}
                      onChange={(e) => setCustomRepackSizeMb(Number(e.target.value))}
                      className="w-16 bg-black/80 border border-slate-700 rounded-lg p-1 text-xs text-cyan-300 font-mono text-center"
                    />
                    <span className="text-xs text-slate-400 font-mono">MB</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between text-[11px] font-mono pt-2 border-t border-slate-800 text-slate-400">
              <span>
                Output Size: <strong className="text-emerald-400 font-bold">~{targetRepackSizeOption === '64mb' ? '64.0 MB' : targetRepackSizeOption === 'custom' ? `${customRepackSizeMb}.0 MB` : targetRepackSizeOption === 'original' && uploadedImage ? uploadedImage.sizeFormatted : '60.0 MB'}</strong>
              </span>
              <span className="text-slate-400">
                Kernel: <strong className="text-cyan-300">~39 MB</strong> • Ramdisk: <strong className="text-amber-300">~18 MB</strong> • DTB: <strong className="text-purple-300">~2.5 MB</strong>
              </span>
            </div>
          </div>

          {/* Quick Repack Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <button 
              onClick={() => handleRepackBootImage('raw_img')}
              disabled={isProcessing}
              className="bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-3 px-4 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(8,145,178,0.3)] transition-all disabled:opacity-50"
            >
              <FileCheck className="w-4 h-4" />
              Repack as Standard boot.img (~60 MB)
            </button>

            <button 
              onClick={() => handleRepackBootImage('samsung_odin_tar')}
              disabled={isProcessing}
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-4 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(37,99,235,0.3)] transition-all disabled:opacity-50"
            >
              <Smartphone className="w-4 h-4" />
              Repack for Samsung Odin (.tar.md5)
            </button>
          </div>

          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <FileDown className="w-3.5 h-3.5 text-emerald-400" />
                Rebuild Artifacts ({rebuiltArtifacts.length})
              </h4>
            </div>

            {rebuiltArtifacts.length === 0 ? (
              <p className="text-xs text-slate-500">Repacked boot images and ramdisks will appear here for re-download.</p>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {rebuiltArtifacts.map(artifact => (
                  <div key={artifact.id} className="bg-slate-950/70 border border-slate-800 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-mono text-slate-200 truncate">{artifact.name}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {artifact.kind.replace('_', ' ')} • {formatBytes(artifact.bytes.length)} • {format(artifact.createdAt, 'HH:mm:ss')}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        downloadBlob(artifact.bytes, artifact.name, artifact.mime);
                        addLog(`Downloaded artifact from rebuild list: "${artifact.name}"`, 'info');
                      }}
                      className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold rounded-lg border border-slate-700 flex items-center gap-1.5 shrink-0"
                    >
                      <Download className="w-3.5 h-3.5 text-emerald-400" />
                      Download
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Unpacked Boot Image Components List */}
      <div className="bg-[#0d131f] p-4 sm:p-6 rounded-xl border border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-base font-bold text-slate-200 uppercase flex items-center gap-2">
              <FolderTree className="w-5 h-5 text-cyan-400" />
              Unpacked Boot Image Components ({imgFiles.length})
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">Kernel binary, ramdisk archive, cmdline, and header configurations.</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleOpenAddFile('img')}
              className="px-3 py-1.5 bg-cyan-950/60 hover:bg-cyan-900/80 border border-cyan-500/30 text-cyan-400 text-xs font-bold uppercase rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add File
            </button>
            {imgFiles.some(f => f.name === 'dtb.img') && (
              <button
                onClick={() => {
                  const dtbFile = imgFiles.find(f => f.name === 'dtb.img');
                  if (dtbFile) {
                    addLog('Sending dtb.img to Device Tree Studio...', 'info');
                    setActiveTab('dtb');
                  }
                }}
                className="px-3 py-1.5 bg-purple-950/60 hover:bg-purple-900/80 border border-purple-500/30 text-purple-400 text-xs font-bold uppercase rounded-lg flex items-center gap-1.5 transition-colors"
              >
                <Code className="w-3.5 h-3.5" /> Open in DTB Studio
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2.5">
          {imgFiles.map(file => (
            <div key={file.id} className="bg-slate-900/60 hover:bg-slate-900/90 border border-slate-800 hover:border-slate-700/80 p-3.5 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg font-mono text-xs font-bold shrink-0 ${
                  file.name === 'kernel' ? 'bg-cyan-950/80 text-cyan-400 border border-cyan-500/30' :
                  file.name.includes('ramdisk') ? 'bg-amber-950/80 text-amber-400 border border-amber-500/30' :
                  file.name.includes('dtb') ? 'bg-purple-950/80 text-purple-400 border border-purple-500/30' :
                  'bg-slate-800 text-slate-300 border border-slate-700'
                }`}>
                  {file.type === 'binary' ? <File className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-slate-100">{file.name}</span>
                    <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">{file.sizeFormatted}</span>
                    {file.updatedAt && (
                      <span className="text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded font-bold uppercase">Modified</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{file.description}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                <button
                  onClick={() => {
                    setActiveViewFile({ file, category: 'img' });
                    setEditedContent(file.content || '');
                  }}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors border border-slate-700"
                >
                  <Eye className="w-3.5 h-3.5 text-cyan-400" />
                  {file.type === 'binary' ? 'Inspect' : 'Edit'}
                </button>
                <button
                  onClick={() => {
                    if (file.content) {
                      downloadBlob(new Uint8Array(new TextEncoder().encode(file.content)), file.name, 'text/plain');
                    } else if (file.binaryData && file.binaryData.length > 0) {
                      downloadBlob(file.binaryData, file.name, 'application/octet-stream');
                      addLog(`Exported binary artifact: ${file.name}`, 'info');
                    } else {
                      addLog(`No binary payload available for "${file.name}"`, 'error');
                    }
                  }}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors border border-slate-700"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // 2. Ramdisk Tools & Modifier Tab
  const renderRamdiskTab = () => {
    const filteredRamdisk = ramdiskFiles.filter(f => 
      f.name.toLowerCase().includes(ramdiskSearchQuery.toLowerCase()) || 
      f.path.toLowerCase().includes(ramdiskSearchQuery.toLowerCase())
    );

    return (
      <div className="space-y-6">
        {/* Ramdisk Header & Quick Actions */}
        <div className="bg-[#0d131f] p-4 sm:p-6 rounded-xl border border-slate-800 shadow-xl space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-amber-950/60 border border-amber-500/30 text-amber-400">
                <Cpu className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold tracking-tight text-slate-100 uppercase">
                  Ramdisk Modifier & CPIO Workspace
                </h2>
                <p className="text-xs text-slate-400">Modify init scripts, patch SELinux & fstab mount rules, and inject kernel modules.</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => handleOpenAddFile('ramdisk')}
                className="px-3 py-2 bg-amber-950/60 hover:bg-amber-900/80 border border-amber-500/30 text-amber-400 text-xs font-bold uppercase rounded-lg flex items-center gap-1.5 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> New Script / File
              </button>
              <button
                onClick={handleDownloadRamdiskCpio}
                disabled={isProcessing}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold uppercase rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5 text-amber-400" /> Export CPIO
              </button>
              <button
                onClick={handleRepackRamdiskCpio}
                disabled={isProcessing}
                className="px-3.5 py-2 bg-amber-600 hover:bg-amber-500 text-black text-xs font-bold uppercase rounded-lg flex items-center gap-1.5 transition-colors shadow-[0_0_15px_rgba(245,158,11,0.3)] disabled:opacity-50"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Repack CPIO (~18 MB)
              </button>
            </div>
          </div>

          {/* Quick Patch Presets Bar */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-yellow-400" /> 1-Click Ramdisk Security & Boot Patches:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              <button
                onClick={() => handleQuickPatchRamdisk('permissive')}
                className="p-3 bg-slate-950 hover:bg-slate-800/80 border border-slate-800 hover:border-cyan-500/40 rounded-lg text-left transition-colors"
              >
                <span className="text-xs font-bold text-cyan-400 block">SELinux Permissive</span>
                <span className="text-[10px] text-slate-400 mt-0.5 block">Inject setenforce 0 into init.rc</span>
              </button>

              <button
                onClick={() => handleQuickPatchRamdisk('disable_verity')}
                className="p-3 bg-slate-950 hover:bg-slate-800/80 border border-slate-800 hover:border-red-500/40 rounded-lg text-left transition-colors"
              >
                <span className="text-xs font-bold text-red-400 block">Disable dm-verity / AVB</span>
                <span className="text-[10px] text-slate-400 mt-0.5 block">Strip verify & forceencrypt in fstab</span>
              </button>

              <button
                onClick={() => handleQuickPatchRamdisk('enable_adb')}
                className="p-3 bg-slate-950 hover:bg-slate-800/80 border border-slate-800 hover:border-emerald-500/40 rounded-lg text-left transition-colors"
              >
                <span className="text-xs font-bold text-emerald-400 block">Enable Root ADB</span>
                <span className="text-[10px] text-slate-400 mt-0.5 block">Set ro.debuggable=1 & adb secure=0</span>
              </button>

              <button
                onClick={() => handleQuickPatchRamdisk('magisk_hook')}
                className="p-3 bg-slate-950 hover:bg-slate-800/80 border border-slate-800 hover:border-amber-500/40 rounded-lg text-left transition-colors"
              >
                <span className="text-xs font-bold text-amber-400 block">Magisk / KSU Hook</span>
                <span className="text-[10px] text-slate-400 mt-0.5 block">Inject overlay.d early-init stage</span>
              </button>
            </div>
          </div>

          {/* Module Injection Bar */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-amber-400" /> Inject Kernel Module (.ko) into Ramdisk
            </h4>
            <div className="flex flex-col sm:flex-row gap-2">
              <input 
                type="text" 
                value={moduleFileName} 
                onChange={(e) => setModuleFileName(e.target.value)} 
                placeholder="e.g. wlan.ko or custom_display_panel.ko" 
                className="flex-1 bg-black/60 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-xs font-mono focus:outline-none focus:border-amber-500" 
              />
              <button 
                onClick={() => moduleFileInputRef.current?.click()} 
                className="bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-lg text-slate-200 font-semibold text-xs uppercase"
              >
                Browse .ko
              </button>
              <button 
                onClick={() => {
                  const name = moduleFileName.trim() || 'custom_driver.ko';
                  const newMod: UnpackedFileItem = {
                    id: 'rd_mod_' + Date.now(),
                    name,
                    path: `/unpacked/ramdisk/lib/modules/${name}`,
                    sizeFormatted: '184 KB',
                    type: 'binary',
                    description: 'Injected ARM64 kernel module (.ko)',
                    updatedAt: new Date()
                  };
                  setRamdiskFiles(prev => [...prev, newMod]);
                  addLog(`Injected kernel driver "${name}" into /unpacked/ramdisk/lib/modules/`, 'success');
                  setModuleFileName('');
                }}
                className="bg-amber-600 hover:bg-amber-500 text-black px-4 py-2 rounded-lg font-bold text-xs uppercase"
              >
                Inject Module
              </button>
            </div>
          </div>
        </div>

        {/* Ramdisk File Tree / Explorer */}
        <div className="bg-[#0d131f] p-4 sm:p-6 rounded-xl border border-slate-800 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-base font-bold text-slate-200 uppercase flex items-center gap-2">
                <FolderTree className="w-5 h-5 text-amber-400" />
                Ramdisk Files & Scripts ({ramdiskFiles.length})
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">Click any text file to edit inline, view mount points, and download.</p>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input 
                type="text"
                value={ramdiskSearchQuery}
                onChange={(e) => setRamdiskSearchQuery(e.target.value)}
                placeholder="Search ramdisk files..."
                className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5">
            {filteredRamdisk.map(file => (
              <div key={file.id} className="bg-slate-900/60 hover:bg-slate-900/90 border border-slate-800 hover:border-slate-700 p-3.5 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg font-mono text-xs font-bold shrink-0 ${
                    file.type === 'binary' ? 'bg-purple-950/80 text-purple-400 border border-purple-500/30' :
                    'bg-amber-950/80 text-amber-400 border border-amber-500/30'
                  }`}>
                    {file.type === 'binary' ? <File className="w-4 h-4" /> : <FileCode className="w-4 h-4" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-slate-100">{file.name}</span>
                      <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">{file.sizeFormatted}</span>
                      {file.updatedAt && (
                        <span className="text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded font-bold uppercase">Modified</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 font-mono mt-0.5">{file.path}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                  <button
                    onClick={() => {
                      setActiveViewFile({ file, category: 'ramdisk' });
                      setEditedContent(file.content || '');
                    }}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors border border-slate-700"
                  >
                    <Eye className="w-3.5 h-3.5 text-amber-400" />
                    {file.type === 'binary' ? 'Inspect' : 'Edit Script'}
                  </button>

                  <button
                    onClick={() => handleDeleteRamdiskFile(file.id, file.name)}
                    className="p-1.5 bg-red-950/40 hover:bg-red-900/60 border border-red-800/40 text-red-400 rounded-lg transition-colors"
                    title="Delete file from ramdisk"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // 3. Device Tree Studio (DTB ↔ DTS Converter & Decompiler)
  const renderDtbTab = () => (
    <div className="space-y-6">
      {/* Studio Banner */}
      <div className="bg-[#0d131f] p-4 sm:p-6 rounded-xl border border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-purple-950/60 border border-purple-500/30 text-purple-400">
              <Code className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight text-slate-100 uppercase flex items-center gap-2">
                Device Tree Studio (DTB ↔ DTS)
              </h2>
              <p className="text-xs text-slate-400">Convert compiled binary Device Tree Blobs (DTB) into human-readable DTS, and compile DTS into standard DTBs.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => dtbFileInputRef.current?.click()}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <UploadCloud className="w-3.5 h-3.5 text-purple-400" />
              Upload .dtb to Decompile
            </button>
            <button
              onClick={handleCompileDtsToDtb}
              disabled={isProcessing}
              className="px-3.5 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold uppercase rounded-lg flex items-center gap-1.5 transition-colors shadow-[0_0_15px_rgba(168,85,247,0.3)] disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              Compile DTS → DTB
            </button>
          </div>
        </div>

        {/* Presets & Actions Toolbar */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400 font-semibold uppercase text-[10px] tracking-wider">Device Presets:</span>
            <button
              onClick={() => handleSelectDtsPreset('samsung_exynos')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                selectedDtsPreset === 'samsung_exynos' 
                  ? 'bg-blue-600/20 text-blue-400 border border-blue-500/40' 
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Samsung Exynos 990 / 2200
            </button>
            <button
              onClick={() => handleSelectDtsPreset('qualcomm_mainline')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                selectedDtsPreset === 'qualcomm_mainline' 
                  ? 'bg-purple-600/20 text-purple-400 border border-purple-500/40' 
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Qualcomm SM8550 Mainline
            </button>
            <button
              onClick={() => handleSelectDtsPreset('generic_arm64_virt')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                selectedDtsPreset === 'generic_arm64_virt' 
                  ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/40' 
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Generic ARM64 Virt
            </button>
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto justify-end">
            <button
              onClick={handleDownloadDts}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors border border-slate-700"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" /> Save .dts
            </button>
            <button
              onClick={handleDownloadDtb}
              className="px-3 py-1.5 bg-purple-950/60 hover:bg-purple-900/80 border border-purple-500/40 text-purple-300 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-purple-400" /> Export .dtb
            </button>
            <button
              onClick={handleInjectDtbToWorkspace}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold uppercase rounded-lg flex items-center gap-1.5 transition-colors shadow-sm"
              title="Attaches this DTB directly to the active boot.img workspace"
            >
              <Check className="w-3.5 h-3.5" /> Inject into Boot.img
            </button>
          </div>
        </div>
      </div>

      {/* Side-by-Side Editor & Node Tree Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* DTS Code Editor */}
        <div className="lg:col-span-8 bg-[#0d131f] p-4 sm:p-5 rounded-xl border border-slate-800 shadow-xl flex flex-col min-h-[550px]">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <FileCode className="w-4 h-4 text-purple-400" />
              <span className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono">
                Device Tree Source (DTS Syntax)
              </span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">Standard /dts-v1/ formatting</span>
          </div>

          <textarea
            value={dtsContent}
            onChange={(e) => setDtsContent(e.target.value)}
            spellCheck={false}
            className="flex-1 w-full bg-black/80 text-cyan-300 font-mono text-xs p-4 rounded-lg border border-slate-800 focus:outline-none focus:border-purple-500 leading-relaxed resize-none shadow-inner"
            rows={22}
          />

          <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
            <span>Lines: {dtsContent.split('\n').length} • Size: {formatBytes(dtsContent.length)}</span>
            <span className="text-emerald-400 font-mono">FDT Magic 0xd00dfeed compatible</span>
          </div>
        </div>

        {/* Device Tree Node Structure / Inspector */}
        <div className="lg:col-span-4 bg-[#0d131f] p-4 sm:p-5 rounded-xl border border-slate-800 shadow-xl flex flex-col min-h-[550px]">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                Node Hierarchy & Properties
              </span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1 text-xs">
            {dtsParseResult?.rootNode ? (
              <div className="space-y-2 font-mono">
                <div className="p-2.5 bg-slate-900/80 rounded-lg border border-slate-800">
                  <div className="flex items-center gap-1.5 text-cyan-400 font-bold">
                    <ChevronDown className="w-3.5 h-3.5" /> / (root)
                  </div>
                  <div className="pl-4 mt-2 space-y-1 text-[11px] text-slate-400">
                    {dtsParseResult.rootNode.properties.slice(0, 5).map(p => (
                      <div key={p.name} className="truncate">
                        <strong className="text-slate-300">{p.name}:</strong> <span className="text-purple-300">{p.value || 'true'}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {dtsParseResult.rootNode.children.map(child => (
                  <div key={child.name} className="p-2.5 bg-slate-900/60 rounded-lg border border-slate-800">
                    <div className="flex items-center justify-between text-slate-200 font-semibold text-[11px]">
                      <span className="text-amber-400 font-mono">{child.name}</span>
                      <span className="text-[9px] bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded font-mono">
                        {child.properties.length} props
                      </span>
                    </div>
                    {child.properties.length > 0 && (
                      <div className="pl-2 mt-1.5 space-y-0.5 text-[10px] text-slate-400">
                        {child.properties.slice(0, 3).map(p => (
                          <div key={p.name} className="truncate">
                            <span className="text-slate-400">{p.name}:</span> <span className="text-cyan-300">{p.value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 bg-slate-900/40 rounded-lg border border-slate-800/80 text-center text-slate-500 space-y-2">
                <Info className="w-8 h-8 mx-auto text-slate-600" />
                <p className="text-xs">Click "Compile DTS → DTB" to inspect real parsed FDT node structures, addresses, and phandles.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // 4. Samsung Quirks & Repack Toolkit Tab
  const renderSamsungTab = () => (
    <div className="space-y-6">
      <div className="bg-[#0d131f] p-4 sm:p-6 rounded-xl border border-slate-800 shadow-xl space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-blue-950/60 border border-blue-500/30 text-blue-400">
            <Smartphone className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight text-slate-100 uppercase flex items-center gap-2">
              Samsung Boot Image & Odin Flasher Toolkit
            </h2>
            <p className="text-xs text-slate-400">Handles SEAndroid Enforcing footers, Odin POSIX UStar packaging, and Knox warranty bit mitigation.</p>
          </div>
        </div>

        {/* Samsung Specific Warning & Info Box */}
        <div className="bg-blue-950/20 border border-blue-500/30 rounded-xl p-4 flex items-start gap-3.5">
          <AlertTriangle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1 text-slate-300">
            <p className="font-bold text-blue-300">Samsung Bootloader Verification Details:</p>
            <p>
              Samsung bootloaders require an exact 512-byte aligned <strong className="text-blue-300">SEANDROIDENFORCE</strong> or <strong className="text-blue-300">NO KNOX</strong> magic string appended at the tail of the image. Missing this causes bootloop or the red warning: <em>"KERNEL IS NOT SEANDROID ENFORCING"</em>.
            </p>
            <p>
              Additionally, Samsung Odin flashes partitions packaged inside uncompressed POSIX <strong className="text-blue-300">.tar</strong> or <strong className="text-blue-300">.tar.md5</strong> files.
            </p>
          </div>
        </div>

        {/* Configuration Switches */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* SEAndroid Footer Settings */}
          <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-slate-200">SEAndroid Magic Footer</span>
              <input 
                type="checkbox"
                checked={samsungConfig.appendSeAndroidFooter}
                onChange={(e) => setSamsungConfig(prev => ({ ...prev, appendSeAndroidFooter: e.target.checked }))}
                className="w-4 h-4 accent-blue-500 rounded cursor-pointer"
              />
            </div>
            <p className="text-xs text-slate-400">Appends SEAndroid block to satisfy Samsung Knox & aboot checks.</p>
            
            {samsungConfig.appendSeAndroidFooter && (
              <div className="pt-2">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Footer Magic String</label>
                <select
                  value={samsungConfig.footerType}
                  onChange={(e) => setSamsungConfig(prev => ({ ...prev, footerType: e.target.value as any }))}
                  className="w-full bg-black/60 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 font-mono"
                >
                  <option value="SEANDROIDENFORCE">SEANDROIDENFORCE (Galaxy S7 through S24 / Modern)</option>
                  <option value="NO KNOX">NO KNOX (Legacy Samsung Note / S6)</option>
                </select>
              </div>
            )}
          </div>

          {/* Odin TAR.MD5 Packaging */}
          <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-slate-200">Package for Odin (.tar.md5)</span>
              <input 
                type="checkbox"
                checked={samsungConfig.generateOdinTar}
                onChange={(e) => setSamsungConfig(prev => ({ ...prev, generateOdinTar: e.target.checked }))}
                className="w-4 h-4 accent-blue-500 rounded cursor-pointer"
              />
            </div>
            <p className="text-xs text-slate-400">Generates a flashable TAR package with appended MD5 checksum for Samsung Odin & Heimdall.</p>

            {samsungConfig.generateOdinTar && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-slate-400">Append MD5 hash string:</span>
                <input 
                  type="checkbox"
                  checked={samsungConfig.generateMd5Checksum}
                  onChange={(e) => setSamsungConfig(prev => ({ ...prev, generateMd5Checksum: e.target.checked }))}
                  className="w-4 h-4 accent-blue-500 rounded cursor-pointer"
                />
              </div>
            )}
          </div>
        </div>

        {/* Samsung Kernel Cmdline Patches */}
        <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl space-y-3">
          <span className="text-sm font-bold text-slate-200 block">Samsung Cmdline & Kernel Flags</span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <label className="flex items-center gap-2 p-2.5 bg-black/40 rounded-lg border border-slate-800 text-xs text-slate-300 cursor-pointer">
              <input 
                type="checkbox" 
                checked={samsungConfig.loopMaxPart}
                onChange={(e) => setSamsungConfig(prev => ({ ...prev, loopMaxPart: e.target.checked }))}
                className="accent-blue-500" 
              />
              <span>loop.max_part=7 (System-as-root)</span>
            </label>

            <label className="flex items-center gap-2 p-2.5 bg-black/40 rounded-lg border border-slate-800 text-xs text-slate-300 cursor-pointer">
              <input 
                type="checkbox" 
                checked={samsungConfig.selinuxPermissive}
                onChange={(e) => setSamsungConfig(prev => ({ ...prev, selinuxPermissive: e.target.checked }))}
                className="accent-blue-500" 
              />
              <span>androidboot.selinux=permissive</span>
            </label>

            <label className="flex items-center gap-2 p-2.5 bg-black/40 rounded-lg border border-slate-800 text-xs text-slate-300 cursor-pointer">
              <input 
                type="checkbox" 
                checked={samsungConfig.bypassKnoxWarrantyCmdline}
                onChange={(e) => setSamsungConfig(prev => ({ ...prev, bypassKnoxWarrantyCmdline: e.target.checked }))}
                className="accent-blue-500" 
              />
              <span>androidboot.warranty_bit=0</span>
            </label>
          </div>
        </div>

        {/* Action Button & Size indicator */}
        <div className="pt-2 space-y-2">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
            <span>Expected Output: <strong className="text-blue-400 font-bold">~60.0 MB</strong></span>
            <span>Includes: <strong className="text-slate-200">boot.img + {samsungConfig.footerType} + MD5</strong></span>
          </div>
          <button
            onClick={() => handleRepackBootImage('samsung_odin_tar')}
            disabled={isProcessing}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3.5 px-4 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_0_25px_rgba(37,99,235,0.4)] transition-all disabled:opacity-50"
          >
            <Smartphone className="w-4 h-4" />
            Build Samsung Flashable Odin Package (.tar.md5) (~60 MB)
          </button>
        </div>
      </div>
    </div>
  );

  // 5. Mainline Kernel Builder Tab
  const renderMainlineTab = () => (
    <div className="space-y-6">
      <div className="bg-[#0d131f] p-4 sm:p-6 rounded-xl border border-slate-800 shadow-xl space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-emerald-950/60 border border-emerald-500/30 text-emerald-400">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight text-slate-100 uppercase flex items-center gap-2">
              Mainline Linux Kernel & DTB Boot.img Builder
            </h2>
            <p className="text-xs text-slate-400">Pack uncompressed Image / Image.gz, compiled Device Tree Blobs, and Android ramdisk into a standard boot.img.</p>
          </div>
        </div>

        {/* Ingredients Checklist Card */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 bg-black/40 rounded-lg border border-slate-800">
            <span className="text-[10px] text-slate-500 uppercase font-bold block">1. Mainline Kernel</span>
            <span className="text-xs font-mono font-bold text-slate-200 mt-1 block">Image.gz (ARM64)</span>
            <span className="text-[10px] text-emerald-400 mt-0.5 block flex items-center gap-1">
              <Check className="w-3 h-3" /> Ready
            </span>
          </div>

          <div className="p-3 bg-black/40 rounded-lg border border-slate-800">
            <span className="text-[10px] text-slate-500 uppercase font-bold block">2. Device Tree (DTB)</span>
            <span className="text-xs font-mono font-bold text-slate-200 mt-1 block">
              {compiledDtbBytes ? `Compiled (${formatBytes(compiledDtbBytes.length)})` : 'Using Active DTS'}
            </span>
            <span className="text-[10px] text-purple-400 mt-0.5 block flex items-center gap-1">
              <Check className="w-3 h-3" /> DTB Attached
            </span>
          </div>

          <div className="p-3 bg-black/40 rounded-lg border border-slate-800">
            <span className="text-[10px] text-slate-500 uppercase font-bold block">3. Android Ramdisk</span>
            <span className="text-xs font-mono font-bold text-slate-200 mt-1 block">{ramdiskFiles.length} files in CPIO</span>
            <span className="text-[10px] text-amber-400 mt-0.5 block flex items-center gap-1">
              <Check className="w-3 h-3" /> Rootfs Ready
            </span>
          </div>
        </div>

        {/* Mainline Header & Address Parameters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Target Header Version</label>
            <select
              value={mainlineConfig.targetHeaderVersion}
              onChange={(e) => setMainlineConfig(prev => ({ ...prev, targetHeaderVersion: Number(e.target.value) as any }))}
              className="w-full bg-black/60 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-200 font-mono"
            >
              <option value={2}>v2 (Header with Embedded DTB)</option>
              <option value={4}>v4 (GKI Mainline v4 Format)</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Kernel Base Address</label>
            <input 
              type="text" 
              value={mainlineConfig.baseAddress} 
              onChange={(e) => setMainlineConfig(prev => ({ ...prev, baseAddress: e.target.value }))}
              className="w-full bg-black/60 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 font-mono" 
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Ramdisk Offset</label>
            <input 
              type="text" 
              value={mainlineConfig.ramdiskOffset} 
              onChange={(e) => setMainlineConfig(prev => ({ ...prev, ramdiskOffset: e.target.value }))}
              className="w-full bg-black/60 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 font-mono" 
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">DTB Offset</label>
            <input 
              type="text" 
              value={mainlineConfig.dtbOffset} 
              onChange={(e) => setMainlineConfig(prev => ({ ...prev, dtbOffset: e.target.value }))}
              className="w-full bg-black/60 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 font-mono" 
            />
          </div>
        </div>

        {/* Mainline Kernel Commandline */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3">
          <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
            Mainline Command Line (earlycon & console)
          </label>
          <input 
            type="text"
            value={mainlineConfig.cmdline}
            onChange={(e) => setMainlineConfig(prev => ({ ...prev, cmdline: e.target.value }))}
            className="w-full bg-black/60 border border-slate-700 rounded-lg p-2.5 text-xs text-cyan-300 font-mono"
          />

          <div className="flex flex-wrap items-center gap-4 pt-1">
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input 
                type="checkbox" 
                checked={mainlineConfig.enableEarlycon}
                onChange={(e) => setMainlineConfig(prev => ({ ...prev, enableEarlycon: e.target.checked }))}
                className="accent-emerald-500" 
              />
              <span>Include earlycon</span>
            </label>

            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input 
                type="checkbox" 
                checked={mainlineConfig.ignoreUnusedClocks}
                onChange={(e) => setMainlineConfig(prev => ({ ...prev, ignoreUnusedClocks: e.target.checked }))}
                className="accent-emerald-500" 
              />
              <span>clk_ignore_unused</span>
            </label>

            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input 
                type="checkbox" 
                checked={mainlineConfig.ignoreUnusedPowerDomains}
                onChange={(e) => setMainlineConfig(prev => ({ ...prev, ignoreUnusedPowerDomains: e.target.checked }))}
                className="accent-emerald-500" 
              />
              <span>pd_ignore_unused</span>
            </label>
          </div>
        </div>

        {/* Build Action */}
        <button
          onClick={handleBuildMainlineBootImg}
          disabled={isProcessing}
          className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3.5 px-4 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_0_25px_rgba(16,185,129,0.4)] transition-all disabled:opacity-50"
        >
          <Play className="w-4 h-4" />
          Build Mainline Android-Compatible boot.img
        </button>
      </div>
    </div>
  );

  // --- Partition Resize & Management Handlers ---
  const currentStorageProfile = STORAGE_PROFILES.find(p => p.id === selectedStorageProfileId) || STORAGE_PROFILES[0];
  const currentLayoutAnalysis = analyzeDeviceLayout(partitions, currentStorageProfile);

  const handleOpenResizeModal = (partition: PartitionInfo) => {
    setResizingPartition(partition);
    const bytes = partition.sizeBytes || parseFormattedSizeToBytes(partition.size);
    if (bytes >= 1024 * 1024 * 1024) {
      setResizeInputValue((bytes / (1024 * 1024 * 1024)).toFixed(2));
      setResizeUnit('GB');
    } else {
      setResizeInputValue(Math.round(bytes / (1024 * 1024)).toString());
      setResizeUnit('MB');
    }
    setActiveCommandTab(0);
    setCopiedCommand(false);
  };

  const handleApplyResize = () => {
    if (!resizingPartition) return;
    const num = parseFloat(resizeInputValue) || 0;
    let newSizeBytes = 0;
    if (resizeUnit === 'GB') newSizeBytes = Math.round(num * 1024 * 1024 * 1024);
    else if (resizeUnit === 'MB') newSizeBytes = Math.round(num * 1024 * 1024);
    else if (resizeUnit === 'KB') newSizeBytes = Math.round(num * 1024);

    const validation = validatePartitionResize(resizingPartition, newSizeBytes, partitions, currentStorageProfile);
    if (!validation.isValid) return;

    const formatted = formatBytesHuman(newSizeBytes);
    const oldSize = resizingPartition.size;

    setPartitions(prev => prev.map(p => {
      if (p.id === resizingPartition.id) {
        return {
          ...p,
          size: formatted,
          sizeBytes: newSizeBytes
        };
      }
      return p;
    }));

    addLog(
      `Resized partition ${resizingPartition.name} from ${oldSize} to ${formatted} (${validation.deltaFormatted}). Remaining unallocated storage: ${formatBytesHuman(Math.max(0, validation.unallocatedAvailableBytes - validation.deltaBytes))}.`,
      'success'
    );
    setResizingPartition(null);
  };

  const handleResetPartitions = () => {
    setPartitions(INITIAL_DEVICE_PARTITIONS);
    addLog(`Reset partition table layout to default ${currentStorageProfile.name} configuration.`, 'info');
  };

  const handleExportPartitions = () => {
    const payload = {
      deviceProfile: currentStorageProfile,
      layoutAnalysis: currentLayoutAnalysis,
      partitions: partitions.map(p => ({
        id: p.id,
        name: p.name,
        size: p.size,
        sizeBytes: p.sizeBytes,
        filesystem: p.filesystem,
        isDynamic: p.isDynamic,
        minSizeBytes: p.minSizeBytes,
        maxSizeBytes: p.maxSizeBytes,
        isMountableRW: p.isMountableRW,
        isMountedRW: p.isMountedRW,
        partitionType: p.partitionType,
        description: p.description
      })),
      timestamp: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `android_partition_layout_${selectedStorageProfileId}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addLog(`Exported partition table scheme to ${a.download}`, 'success');
  };

  const handleAddCustomPartition = () => {
    const sizeBytes = newPartSizeMB * 1024 * 1024;
    if (sizeBytes > currentLayoutAnalysis.unallocatedBytes) {
      addLog(`Cannot allocate ${newPartSizeMB} MB. Device only has ${formatBytesHuman(currentLayoutAnalysis.unallocatedBytes)} unallocated free space.`, 'error');
      return;
    }
    const cleanName = newPartName.startsWith('/') ? newPartName : '/' + newPartName;
    const newPart: PartitionInfo = {
      id: 'part_custom_' + Date.now(),
      name: cleanName,
      size: formatBytesHuman(sizeBytes),
      sizeBytes: sizeBytes,
      minSizeBytes: 16 * 1024 * 1024,
      filesystem: newPartFs,
      isMountableRW: true,
      isMountedRW: false,
      isDynamic: true,
      partitionType: 'Custom Staging Partition',
      description: 'User-allocated staging partition in device flash storage'
    };
    setPartitions(prev => [...prev, newPart]);
    addLog(`Created custom partition ${cleanName} (${formatBytesHuman(sizeBytes)})`, 'success');
    setShowAddPartitionModal(false);
    setNewPartName('/cust');
    setNewPartSizeMB(512);
  };

  const handleDeletePartition = (id: string, name: string) => {
    setPartitions(prev => prev.filter(p => p.id !== id));
    addLog(`Deleted custom partition ${name}. Reclaimed space into unallocated pool.`, 'info');
  };

  // 6. Device Partitions Tab
  const renderPartitionsTab = () => {
    const toggleRW = (id: string) => {
      setPartitions(prev => prev.map(p => {
        if (p.id === id && p.isMountableRW) {
          const next = !p.isMountedRW;
          addLog(`Partition ${p.name} remounted as ${next ? 'Read-Write (rw)' : 'Read-Only (ro)'}`, 'info');
          return { ...p, isMountedRW: next };
        }
        return p;
      }));
    };

    // Palette for storage visualizer segments
    const getPartitionColor = (name: string, index: number) => {
      if (name.includes('boot')) return 'bg-amber-500 hover:bg-amber-400';
      if (name.includes('system')) return 'bg-blue-600 hover:bg-blue-500';
      if (name.includes('vendor')) return 'bg-purple-600 hover:bg-purple-500';
      if (name.includes('product')) return 'bg-indigo-600 hover:bg-indigo-500';
      if (name.includes('data') || name.includes('userdata')) return 'bg-emerald-600 hover:bg-emerald-500';
      if (name.includes('recovery')) return 'bg-rose-600 hover:bg-rose-500';
      const colors = ['bg-cyan-600', 'bg-teal-600', 'bg-violet-600', 'bg-fuchsia-600'];
      return colors[index % colors.length];
    };

    return (
      <div className="bg-[#0d131f] p-4 sm:p-6 rounded-xl border border-slate-800 shadow-xl space-y-6">
        {/* Header & Device Storage Layout Selector */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-cyan-950/60 border border-cyan-500/30 text-cyan-400">
              <HardDrive className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight text-slate-100 uppercase flex items-center gap-2">
                Storage Partition Manager & Device Layout
              </h2>
              <p className="text-xs text-slate-400">
                Adjust partition capacities with live minimum/maximum layout bounds validation and Fastboot command generator.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1.5 bg-black/60 border border-slate-700 rounded-lg px-2.5 py-1">
              <span className="text-[10px] uppercase font-bold text-slate-400">Device Layout:</span>
              <select
                value={selectedStorageProfileId}
                onChange={(e) => {
                  setSelectedStorageProfileId(e.target.value);
                  const prof = STORAGE_PROFILES.find(p => p.id === e.target.value);
                  if (prof) {
                    addLog(`Switched target storage layout to ${prof.name}`, 'info');
                  }
                }}
                className="bg-transparent text-xs text-cyan-300 font-mono font-semibold focus:outline-none cursor-pointer"
              >
                {STORAGE_PROFILES.map(prof => (
                  <option key={prof.id} value={prof.id} className="bg-slate-900 text-slate-200">
                    {prof.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => setShowAddPartitionModal(true)}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors border border-slate-700"
              title="Allocate a custom staging partition from unallocated space"
            >
              <Plus className="w-3.5 h-3.5 text-cyan-400" /> Add Partition
            </button>

            <button
              onClick={handleResetPartitions}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors border border-slate-700"
              title="Reset partition sizes to layout defaults"
            >
              <RefreshCw className="w-3.5 h-3.5 text-amber-400" /> Reset
            </button>

            <button
              onClick={handleExportPartitions}
              className="px-3 py-1.5 bg-cyan-950/60 hover:bg-cyan-900/80 border border-cyan-500/40 text-cyan-300 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
              title="Export partition table JSON schema"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" /> Export
            </button>
          </div>
        </div>

        {/* Device Storage Metrics Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-black/50 p-3.5 rounded-xl border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Total Flash Capacity</span>
            <span className="text-base sm:text-lg font-mono font-bold text-slate-100 mt-1 block">
              {formatBytesHuman(currentStorageProfile.totalCapacityBytes)}
            </span>
            <span className="text-[10px] text-cyan-400 mt-0.5 block truncate">
              {currentStorageProfile.storageType}
            </span>
          </div>

          <div className="bg-black/50 p-3.5 rounded-xl border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Allocated Storage</span>
            <span className="text-base sm:text-lg font-mono font-bold text-purple-300 mt-1 block">
              {formatBytesHuman(currentLayoutAnalysis.totalAllocatedBytes)}
            </span>
            <span className="text-[10px] text-slate-400 mt-0.5 block">
              {currentLayoutAnalysis.allocationPercentage.toFixed(1)}% of total device pool
            </span>
          </div>

          <div className={`p-3.5 rounded-xl border ${
            currentLayoutAnalysis.isOverAllocated 
              ? 'bg-red-950/30 border-red-500/40' 
              : currentLayoutAnalysis.unallocatedBytes < 1024 * 1024 * 1024 
                ? 'bg-amber-950/30 border-amber-500/40' 
                : 'bg-black/50 border-slate-800'
          }`}>
            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Unallocated Free Space</span>
            <span className={`text-base sm:text-lg font-mono font-bold mt-1 block ${
              currentLayoutAnalysis.isOverAllocated 
                ? 'text-red-400' 
                : currentLayoutAnalysis.unallocatedBytes < 1024 * 1024 * 1024 
                  ? 'text-amber-400' 
                  : 'text-emerald-400'
            }`}>
              {formatBytesHuman(currentLayoutAnalysis.unallocatedBytes)}
            </span>
            <span className="text-[10px] text-slate-400 mt-0.5 block">
              {currentLayoutAnalysis.isOverAllocated 
                ? 'Overallocated layout!' 
                : `${currentLayoutAnalysis.freePercentage.toFixed(1)}% available to expand`}
            </span>
          </div>

          <div className="bg-black/50 p-3.5 rounded-xl border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Device Architecture</span>
            <span className="text-base sm:text-lg font-mono font-bold text-slate-200 mt-1 block">
              {currentStorageProfile.sectorSize} B Sector
            </span>
            <span className="text-[10px] text-slate-400 mt-0.5 block truncate">
              {formatBytesHuman(currentStorageProfile.reservedOverheadBytes)} reserved GPT/RPMB
            </span>
          </div>
        </div>

        {/* Over-allocation warning banner */}
        {currentLayoutAnalysis.isOverAllocated && (
          <div className="p-3.5 bg-red-950/40 border border-red-500/50 rounded-xl flex items-center gap-3 text-red-300 text-xs">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
            <div>
              <strong className="font-bold">Partition Layout Over-Allocated!</strong> The configured partitions exceed the target {currentStorageProfile.name} capacity by {formatBytesHuman(currentLayoutAnalysis.overAllocatedBytes)}. Please resize down large partitions (such as /data or /system) or select a larger storage profile.
            </div>
          </div>
        )}

        {/* Visual Storage Layout Bar */}
        <div className="bg-black/60 p-4 rounded-xl border border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              Flash Storage Distribution Map
            </span>
            <span className="font-mono text-[11px] text-slate-400">
              Click any partition block to resize
            </span>
          </div>

          {/* Proportional Segmented Bar */}
          <div className="h-7 w-full bg-slate-900 rounded-lg overflow-hidden flex border border-slate-700/80 shadow-inner">
            {partitions.map((p, idx) => {
              const pBytes = p.sizeBytes || parseFormattedSizeToBytes(p.size);
              const pct = (pBytes / currentStorageProfile.totalCapacityBytes) * 100;
              const displayPct = Math.max(1.8, pct);
              return (
                <button
                  key={p.id}
                  onClick={() => handleOpenResizeModal(p)}
                  style={{ width: `${displayPct}%` }}
                  title={`${p.name} (${p.size}) - Click to resize`}
                  className={`${getPartitionColor(p.name, idx)} h-full transition-all relative group border-r border-slate-900/60 focus:outline-none focus:ring-2 focus:ring-cyan-400 z-10 flex items-center justify-center overflow-hidden`}
                >
                  <span className="text-[10px] font-mono font-bold text-white px-1 truncate opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-transform">
                    {p.name.replace('/', '')}
                  </span>
                </button>
              );
            })}

            {/* Unallocated Space segment */}
            {currentLayoutAnalysis.unallocatedBytes > 0 && (
              <div
                style={{ width: `${Math.max(2, currentLayoutAnalysis.freePercentage)}%` }}
                title={`Unallocated Free Space: ${formatBytesHuman(currentLayoutAnalysis.unallocatedBytes)}`}
                className="h-full bg-slate-800/80 border-r border-slate-900/40 relative flex items-center justify-center text-[10px] font-mono font-bold text-slate-400 overflow-hidden"
              >
                <span className="px-1 truncate">Free ({formatBytesHuman(currentLayoutAnalysis.unallocatedBytes)})</span>
              </div>
            )}
          </div>

          {/* Legend Badges */}
          <div className="flex flex-wrap items-center gap-2 pt-1 text-[10px] font-mono">
            {partitions.map((p, idx) => (
              <button
                key={p.id}
                onClick={() => handleOpenResizeModal(p)}
                className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-900/80 hover:bg-slate-800 border border-slate-800 text-slate-300 transition-colors"
              >
                <span className={`w-2 h-2 rounded-full ${getPartitionColor(p.name, idx)}`}></span>
                <span className="font-bold">{p.name}:</span>
                <span className="text-slate-400">{p.size}</span>
              </button>
            ))}
            {currentLayoutAnalysis.unallocatedBytes > 0 && (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-900/80 border border-dashed border-slate-700 text-slate-400">
                <span className="w-2 h-2 rounded-full bg-slate-600"></span>
                <span>Unallocated: {formatBytesHuman(currentLayoutAnalysis.unallocatedBytes)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Partitions Table */}
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-900/90 text-slate-400 uppercase border-b border-slate-800 text-[11px]">
              <tr>
                <th className="p-3">Partition</th>
                <th className="p-3">Current Size</th>
                <th className="p-3">Min Safe Bound</th>
                <th className="p-3">Max Layout Bound</th>
                <th className="p-3">Filesystem</th>
                <th className="p-3">State</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {partitions.map(p => {
                const pBytes = p.sizeBytes || parseFormattedSizeToBytes(p.size);
                const minSafe = p.minSizeBytes || Math.max(4 * 1024 * 1024, Math.round(pBytes * 0.2));
                const maxLayoutAvailable = pBytes + currentLayoutAnalysis.unallocatedBytes;
                const maxSafe = p.maxSizeBytes ? Math.min(p.maxSizeBytes, maxLayoutAvailable) : maxLayoutAvailable;

                return (
                  <tr key={p.id} className="hover:bg-slate-900/50 transition-colors">
                    <td className="p-3 font-bold text-slate-200">
                      <div className="flex items-center gap-2">
                        <span>{p.name}</span>
                        {p.isDynamic ? (
                          <span className="text-[9px] bg-purple-950/80 text-purple-300 px-1.5 py-0.2 rounded border border-purple-500/30 uppercase font-semibold">
                            Dynamic
                          </span>
                        ) : (
                          <span className="text-[9px] bg-slate-800 text-slate-400 px-1.5 py-0.2 rounded border border-slate-700 uppercase font-semibold">
                            Raw GPT
                          </span>
                        )}
                      </div>
                      {p.partitionType && (
                        <div className="text-[10px] text-slate-400 font-normal mt-0.5">
                          {p.partitionType}
                        </div>
                      )}
                    </td>

                    <td className="p-3 font-bold text-cyan-300">
                      {p.size}
                      <span className="text-[10px] text-slate-400 block font-normal">
                        {((pBytes / currentStorageProfile.totalCapacityBytes) * 100).toFixed(1)}% of flash
                      </span>
                    </td>

                    <td className="p-3 text-slate-400">
                      {formatBytesHuman(minSafe)}
                    </td>

                    <td className="p-3 text-slate-400 font-mono">
                      {formatBytesHuman(maxSafe)}
                      {p.maxSizeBytes && (
                        <span className="text-[9px] text-amber-400/80 block">(HW Block Cap)</span>
                      )}
                    </td>

                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-cyan-400 text-[10px] uppercase font-bold border border-slate-700">
                        {p.filesystem}
                      </span>
                    </td>

                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        p.isMountedRW ? 'bg-amber-950/80 text-amber-400 border border-amber-500/30' : 'bg-slate-800 text-slate-400'
                      }`}>
                        {p.isMountedRW ? 'Read-Write (rw)' : 'Read-Only (ro)'}
                      </span>
                    </td>

                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleOpenResizeModal(p)}
                          className="px-2.5 py-1 bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-500/40 text-cyan-300 text-[11px] font-semibold rounded flex items-center gap-1 transition-colors"
                          title="Resize partition by adjusting capacity value with device bounds validation"
                        >
                          <Sliders className="w-3 h-3 text-cyan-400" /> Resize
                        </button>

                        {p.isMountableRW && (
                          <button
                            onClick={() => toggleRW(p.id)}
                            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] rounded transition-colors"
                          >
                            Mount {p.isMountedRW ? 'RO' : 'RW'}
                          </button>
                        )}

                        {p.id.startsWith('part_custom_') && (
                          <button
                            onClick={() => handleDeletePartition(p.id, p.name)}
                            className="p-1 bg-red-950/60 hover:bg-red-900/80 border border-red-500/30 text-red-400 rounded transition-colors"
                            title="Delete custom partition"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // 7. Flasher Tab
  const renderFlasherTab = () => (
    <div className="bg-[#0d131f] p-4 sm:p-6 rounded-xl border border-slate-800 shadow-xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-lg bg-yellow-950/60 border border-yellow-500/30 text-yellow-400">
          <Zap className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-100 uppercase">
            Hardware Flasher & Target Manager
          </h2>
          <p className="text-xs text-slate-400">Flash boot and vendor partitions via Fastboot, Fastbootd, or Samsung Odin protocols.</p>
        </div>
      </div>

      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Connected Target</span>
          <span className="text-sm font-bold text-slate-200 font-mono mt-0.5 block">{connectedDevice}</span>
          <span className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1 font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> Mode: {connectionMode}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <select 
            value={connectionMode} 
            onChange={(e) => setConnectionMode(e.target.value)}
            className="bg-black/60 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 font-mono"
          >
            <option value="Odin / Download Mode">Odin / Download Mode (Samsung)</option>
            <option value="Fastbootd">Fastbootd (Userspace)</option>
            <option value="Fastboot (Bootloader)">Fastboot (Bootloader)</option>
          </select>
        </div>
      </div>

      <div className="space-y-3">
        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Target Partition Slot</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {['boot_a', 'boot_b', 'init_boot_a', 'vendor_boot_a'].map(slot => (
            <button
              key={slot}
              onClick={() => setTargetPartition(slot)}
              className={`p-3 rounded-lg font-mono text-xs font-bold transition-all ${
                targetPartition === slot 
                  ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40 shadow-sm' 
                  : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {slot}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={() => {
          simulateProcess(`Flashing ${uploadedImage?.name || 'boot.img'} to ${targetPartition}`, `Flash verification complete. Partition ${targetPartition} written successfully.`);
        }}
        disabled={isProcessing}
        className="w-full bg-yellow-600 hover:bg-yellow-500 text-black font-bold py-3.5 px-4 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_0_25px_rgba(234,179,8,0.3)] transition-all disabled:opacity-50"
      >
        <Zap className="w-4 h-4" />
        Flash Image to Partition ({targetPartition})
      </button>
    </div>
  );

  // 8. Logs Tab
  const renderLogsTab = () => {
    const filteredLogs = logs.filter(l => {
      if (logFilterLevel !== 'all' && l.level !== logFilterLevel) return false;
      if (logSearchQuery.trim() && !l.message.toLowerCase().includes(logSearchQuery.toLowerCase())) return false;
      return true;
    });

    return (
      <div className="bg-[#0d131f] p-4 sm:p-6 rounded-xl border border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-cyan-400" />
            <h2 className="text-base font-bold text-slate-200 uppercase">System & Operation Logs ({logs.length})</h2>
          </div>

          <div className="flex items-center gap-2">
            <input 
              type="text" 
              value={logSearchQuery}
              onChange={(e) => setLogSearchQuery(e.target.value)}
              placeholder="Search logs..." 
              className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1 text-xs text-slate-200 font-mono"
            />
            <button 
              onClick={() => setLogs([])}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs rounded"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="bg-black/80 p-4 rounded-xl border border-slate-800 font-mono text-xs space-y-2 min-h-[400px] max-h-[600px] overflow-y-auto">
          {filteredLogs.length === 0 ? (
            <p className="text-slate-600 text-center py-12 italic">No logs recorded yet.</p>
          ) : (
            filteredLogs.map(l => (
              <div key={l.id} className="flex items-start gap-2.5 leading-relaxed">
                <span className="text-slate-600 shrink-0 font-mono text-[11px]">[{format(l.timestamp, 'HH:mm:ss')}]</span>
                <span className={`
                  ${l.level === 'info' ? 'text-slate-300' : ''}
                  ${l.level === 'success' ? 'text-emerald-400 font-semibold' : ''}
                  ${l.level === 'warn' ? 'text-amber-400' : ''}
                  ${l.level === 'error' ? 'text-red-400 font-bold' : ''}
                `}>
                  {l.message}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  // Nav Items Definition
  const NAV_ITEMS: { id: TabId; label: string; icon: any; badge?: string }[] = [
    { id: 'boot', label: 'Image Workspace', icon: Database },
    { id: 'ramdisk', label: 'Ramdisk Modifier', icon: Cpu, badge: `${ramdiskFiles.length}` },
    { id: 'dtb', label: 'DTB ↔ DTS Studio', icon: Code, badge: 'New' },
    { id: 'samsung', label: 'Samsung & Odin', icon: Smartphone, badge: 'Knox' },
    { id: 'mainline', label: 'Mainline Kernel', icon: Layers },
    { id: 'partitions', label: 'Partitions', icon: HardDrive },
    { id: 'flash', label: 'Device Flasher', icon: Zap },
    { id: 'logs', label: 'System Logs', icon: Terminal, badge: `${logs.length}` },
  ];

  return (
    <div className="min-h-screen bg-[#05070a] text-slate-300 font-sans flex flex-col md:flex-row">
      {/* Hidden Global File Inputs (Broad & Unrestricted for All OS File Dialogs) */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            handleUploadFile(e.target.files[0]);
          }
        }} 
        className="hidden" 
      />
      <input 
        type="file" 
        ref={dtbFileInputRef} 
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            handleDecompileDtbUpload(e.target.files[0]);
          }
        }} 
        className="hidden" 
      />
      <input 
        type="file" 
        ref={moduleFileInputRef} 
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            setModuleFileName(e.target.files[0].name);
            addLog(`Selected module: ${e.target.files[0].name}`, 'info');
          }
        }} 
        className="hidden" 
      />

      {/* Top Mobile Bar */}
      <div className="md:hidden bg-[#070b12] border-b border-slate-800 p-4 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-2.5">
          <button 
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg bg-slate-900 border border-slate-800"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-cyan-400" />
            <h1 className="font-bold text-sm bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
              VORTEX TOOLKIT
            </h1>
          </div>
        </div>

        {uploadedImage && (
          <span className="text-[10px] font-mono text-cyan-300 bg-cyan-950/80 px-2.5 py-1 rounded-full border border-cyan-500/30 truncate max-w-[140px]">
            {uploadedImage.name}
          </span>
        )}
      </div>

      {/* Mobile Drawer Navigation */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 top-[57px] bg-black/90 backdrop-blur-md z-30 p-4 space-y-2 overflow-y-auto">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id);
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all ${
                activeTab === item.id 
                  ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 font-bold' 
                  : 'text-slate-400 hover:bg-slate-900 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-3">
                <item.icon className="w-5 h-5 text-cyan-400" />
                <span>{item.label}</span>
              </div>
              {item.badge && (
                <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Desktop Sidebar (Responsive width) */}
      <div className="hidden md:flex w-64 lg:w-72 bg-[#070b12] border-r border-slate-800 flex-col shrink-0">
        <div className="p-6 border-b border-slate-800/80">
          <h1 className="text-xl font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-500 bg-clip-text text-transparent flex items-center gap-2.5 tracking-wider">
            <Cpu className="w-6 h-6 text-cyan-400" />
            VORTEX TOOLKIT
          </h1>
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mt-1 font-semibold">
            Samsung & Mainline Boot Utility
          </p>
        </div>

        {/* Loaded Image Widget */}
        {uploadedImage ? (
          <div className="p-3 mx-4 my-3 bg-cyan-950/40 border border-cyan-500/30 rounded-xl space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-cyan-400 font-bold">Active Image</span>
              <span className="text-[9px] bg-emerald-950 text-emerald-400 px-1.5 py-0.2 rounded font-mono">v{uploadedImage.headerVersion}</span>
            </div>
            <p className="text-xs font-mono font-bold text-slate-200 truncate">{uploadedImage.name}</p>
            <p className="text-[10px] text-slate-400">{uploadedImage.sizeFormatted} • {uploadedImage.isSamsung ? 'Samsung' : 'Standard'}</p>
          </div>
        ) : (
          <div className="p-3 mx-4 my-3 bg-slate-900/50 border border-slate-800 rounded-xl">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full text-xs text-cyan-400 hover:text-cyan-300 font-bold flex items-center justify-center gap-1.5 py-1"
            >
              <UploadCloud className="w-4 h-4" /> Upload boot.img
            </button>
          </div>
        )}

        {/* Navigation list */}
        <nav className="flex-1 px-4 space-y-1.5 overflow-y-auto">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-all ${
                activeTab === item.id 
                  ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.15)] font-semibold' 
                  : 'text-slate-400 hover:bg-slate-900/60 hover:text-slate-200 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-3">
                <item.icon className={`w-4 h-4 ${activeTab === item.id ? 'text-cyan-400' : 'text-slate-500'}`} />
                <span className="text-xs font-medium">{item.label}</span>
              </div>
              {item.badge && (
                <span className="text-[9px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono">
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Root Access Toggle */}
        <div className="p-4 border-t border-slate-800/80">
          <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-300">Access Mode</span>
              {accessMode === 'root' ? <ShieldAlert className="w-4 h-4 text-red-400" /> : <Shield className="w-4 h-4 text-emerald-400" />}
            </div>
            <div className="flex rounded-lg overflow-hidden border border-slate-700/80 text-[10px] font-bold uppercase tracking-wider">
              <button 
                onClick={() => setAccessMode('no-root')}
                className={`flex-1 py-1 transition-colors ${accessMode === 'no-root' ? 'bg-slate-800 text-slate-200' : 'bg-slate-900 text-slate-500'}`}
              >
                Standard
              </button>
              <button 
                onClick={() => setAccessMode('root')}
                className={`flex-1 py-1 transition-colors ${accessMode === 'root' ? 'bg-red-950 text-red-400 border-l border-red-800' : 'bg-slate-900 text-slate-500 border-l border-slate-800'}`}
              >
                Root
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto">
        <div className="max-w-6xl mx-auto space-y-6">
          {activeTab === 'boot' && renderBootImageTab()}
          {activeTab === 'ramdisk' && renderRamdiskTab()}
          {activeTab === 'dtb' && renderDtbTab()}
          {activeTab === 'samsung' && renderSamsungTab()}
          {activeTab === 'mainline' && renderMainlineTab()}
          {activeTab === 'partitions' && renderPartitionsTab()}
          {activeTab === 'flash' && renderFlasherTab()}
          {activeTab === 'logs' && renderLogsTab()}
        </div>
      </div>

      {/* Hex Inspector Modal */}
      {showHexInspector && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#070b12] border border-cyan-500/30 w-full max-w-3xl rounded-xl shadow-2xl p-5 font-mono text-xs flex flex-col max-h-[85vh]">
            <div className="flex justify-between items-center mb-3 pb-3 border-b border-slate-800">
              <span className="text-cyan-400 font-bold uppercase flex items-center gap-2">
                <Eye className="w-4 h-4" /> Header Hex Dump ({uploadedImage?.name || 'boot.img'})
              </span>
              <button onClick={() => setShowHexInspector(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <pre className="bg-black/90 p-4 rounded-lg border border-slate-800 text-cyan-300 overflow-x-auto text-xs leading-relaxed flex-1">
              {uploadedImage?.hexPreview || 'No hex dump available.'}
            </pre>
          </div>
        </div>
      )}

      {/* File Editor / Viewer Modal */}
      {activeViewFile && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#070b12] border border-cyan-500/30 w-full max-w-3xl rounded-xl shadow-2xl p-5 font-mono text-xs flex flex-col max-h-[85vh]">
            <div className="flex justify-between items-center mb-3 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2 text-cyan-400 font-bold uppercase">
                <FileCode className="w-4 h-4" />
                {activeViewFile.file.name} — {activeViewFile.category === 'img' ? 'Boot Image Component' : 'Ramdisk File'}
              </div>
              <button onClick={() => setActiveViewFile(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-900/60 p-2.5 rounded border border-slate-800 mb-3 text-[11px] text-slate-400 flex justify-between">
              <span>Path: <strong className="text-slate-200">{activeViewFile.file.path}</strong></span>
              <span>Size: <strong className="text-slate-200">{activeViewFile.file.sizeFormatted}</strong></span>
            </div>

            {activeViewFile.file.type === 'binary' ? (
              <div className="bg-black/80 p-5 rounded border border-slate-800 text-slate-400 space-y-2">
                <p className="text-amber-400 font-bold">Binary Artifact</p>
                <p>{activeViewFile.file.description}</p>
                <p className="text-xs text-slate-500">Binary payloads cannot be edited directly as plain text. You can replace or repack them.</p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-h-[300px]">
                <textarea
                  value={editedContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  className="flex-1 w-full bg-black/90 border border-slate-700 rounded-lg p-3 text-cyan-300 font-mono text-xs focus:outline-none focus:border-cyan-500 resize-none leading-relaxed"
                  rows={12}
                />
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-slate-800 flex justify-end gap-2">
              <button onClick={() => setActiveViewFile(null)} className="px-4 py-2 bg-slate-800 text-slate-300 rounded">
                Cancel
              </button>
              {activeViewFile.file.type !== 'binary' && (
                <button 
                  onClick={() => {
                    const { file, category } = activeViewFile;
                    if (category === 'img') {
                      setImgFiles(prev => prev.map(f => f.id === file.id ? { ...f, content: editedContent, updatedAt: new Date() } : f));
                    } else {
                      setRamdiskFiles(prev => prev.map(f => f.id === file.id ? { ...f, content: editedContent, updatedAt: new Date() } : f));
                    }
                    addLog(`Saved modifications to ${file.name}`, 'success');
                    setActiveViewFile(null);
                  }}
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" /> Save Changes
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add New File Modal */}
      {showAddFileModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#070b12] border border-cyan-500/30 w-full max-w-lg rounded-xl shadow-2xl p-5 font-mono text-xs space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-800">
              <span className="text-cyan-400 font-bold uppercase">
                Add File to {showAddFileModal === 'img' ? 'Boot Image' : 'Ramdisk'}
              </span>
              <button onClick={() => setShowAddFileModal(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-400 block mb-1 uppercase">File Name</label>
              <input 
                type="text"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                placeholder="e.g. init.custom.rc or dtb_overlay.dtbo"
                className="w-full bg-black/60 border border-slate-700 rounded-lg p-2 text-slate-200"
              />
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-400 block mb-1 uppercase">File Content</label>
              <textarea 
                value={newFileContent}
                onChange={(e) => setNewFileContent(e.target.value)}
                placeholder="# Enter script contents or parameters..."
                className="w-full bg-black/60 border border-slate-700 rounded-lg p-2.5 text-cyan-300 font-mono"
                rows={5}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button onClick={() => setShowAddFileModal(null)} className="px-4 py-2 bg-slate-800 text-slate-300 rounded">
                Cancel
              </button>
              <button 
                onClick={handleSaveNewFile}
                disabled={!newFileName.trim()}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded flex items-center gap-1.5 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" /> Add to Workspace
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resize Partition Modal */}
      {resizingPartition && (() => {
        const num = parseFloat(resizeInputValue) || 0;
        let newSizeBytes = 0;
        if (resizeUnit === 'GB') newSizeBytes = Math.round(num * 1024 * 1024 * 1024);
        else if (resizeUnit === 'MB') newSizeBytes = Math.round(num * 1024 * 1024);
        else if (resizeUnit === 'KB') newSizeBytes = Math.round(num * 1024);

        const currentBytes = resizingPartition.sizeBytes || parseFormattedSizeToBytes(resizingPartition.size);
        const validation = validatePartitionResize(resizingPartition, newSizeBytes, partitions, currentStorageProfile);

        // Calculate slider bounds in MB
        const minMB = Math.max(1, Math.round(validation.minAllowedBytes / (1024 * 1024)));
        const maxMB = Math.max(minMB + 1, Math.round(validation.maxAllowedBytes / (1024 * 1024)));
        const currentMB = Math.round(newSizeBytes / (1024 * 1024));

        const handleSetSizeMB = (targetMB: number) => {
          if (resizeUnit === 'GB') {
            setResizeInputValue((targetMB / 1024).toFixed(2));
          } else if (resizeUnit === 'MB') {
            setResizeInputValue(targetMB.toString());
          } else {
            setResizeInputValue((targetMB * 1024).toString());
          }
        };

        const handlePresetDeltaMB = (deltaMB: number) => {
          const nextMB = Math.max(minMB, currentMB + deltaMB);
          handleSetSizeMB(nextMB);
        };

        return (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[#070b12] border border-cyan-500/30 w-full max-w-2xl rounded-2xl shadow-2xl p-5 sm:p-6 font-mono text-xs flex flex-col max-h-[90vh] overflow-y-auto space-y-4">
              {/* Header */}
              <div className="flex justify-between items-center pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-cyan-950/80 border border-cyan-500/30 rounded-lg text-cyan-400">
                    <Sliders className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
                      Resize Partition: <span className="text-cyan-400">{resizingPartition.name}</span>
                    </h3>
                    <p className="text-[11px] text-slate-400 font-sans">
                      Target Profile: {currentStorageProfile.name}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setResizingPartition(null)} 
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Partition Spec & Capacity Envelope */}
              <div className="grid grid-cols-3 gap-2.5 bg-slate-900/60 p-3 rounded-xl border border-slate-800 text-[11px]">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase block font-bold">Current Size</span>
                  <span className="font-bold text-slate-200 text-xs mt-0.5 block">{resizingPartition.size}</span>
                  <span className="text-[9px] text-slate-400">{formatBytesHuman(currentBytes, 0)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-amber-500 uppercase block font-bold">Min Safe Bound</span>
                  <span className="font-bold text-amber-300 text-xs mt-0.5 block">{formatBytesHuman(validation.minAllowedBytes)}</span>
                  <span className="text-[9px] text-slate-400">Required by OS</span>
                </div>
                <div>
                  <span className="text-[10px] text-cyan-500 uppercase block font-bold">Max Layout Bound</span>
                  <span className="font-bold text-cyan-300 text-xs mt-0.5 block">{formatBytesHuman(validation.maxAllowedBytes)}</span>
                  <span className="text-[9px] text-slate-400">Free: {formatBytesHuman(currentLayoutAnalysis.unallocatedBytes)}</span>
                </div>
              </div>

              {/* Interactive Value & Unit Input */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                    New Partition Size
                  </label>
                  <span className="text-[10px] text-slate-400 font-mono">
                    Equivalent: <strong className="text-cyan-300">{formatBytesHuman(newSizeBytes)}</strong>
                  </span>
                </div>

                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      step="any"
                      min={0}
                      value={resizeInputValue}
                      onChange={(e) => setResizeInputValue(e.target.value)}
                      className={`w-full bg-black/80 border rounded-xl px-3.5 py-2.5 text-sm font-bold font-mono focus:outline-none transition-colors ${
                        validation.isValid 
                          ? 'border-cyan-500/50 text-cyan-300 focus:border-cyan-400' 
                          : 'border-red-500/80 text-red-300 focus:border-red-400'
                      }`}
                      placeholder="Enter size..."
                    />
                  </div>

                  {/* Unit Selector */}
                  <div className="flex bg-slate-900 border border-slate-700 rounded-xl overflow-hidden p-0.5">
                    {(['MB', 'GB', 'KB'] as const).map(unit => (
                      <button
                        key={unit}
                        type="button"
                        onClick={() => {
                          if (unit === resizeUnit) return;
                          // Convert active bytes to new unit
                          if (unit === 'GB') {
                            setResizeInputValue((newSizeBytes / (1024 * 1024 * 1024)).toFixed(2));
                          } else if (unit === 'MB') {
                            setResizeInputValue(Math.round(newSizeBytes / (1024 * 1024)).toString());
                          } else {
                            setResizeInputValue(Math.round(newSizeBytes / 1024).toString());
                          }
                          setResizeUnit(unit);
                        }}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                          resizeUnit === unit 
                            ? 'bg-cyan-600 text-white shadow-sm' 
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {unit}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Smooth Range Slider */}
              <div className="space-y-1.5 bg-black/40 p-3 rounded-xl border border-slate-800/80">
                <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                  <span>Min: {formatBytesHuman(validation.minAllowedBytes)}</span>
                  <span className="text-cyan-400 font-bold">{formatBytesHuman(newSizeBytes)}</span>
                  <span>Max: {formatBytesHuman(validation.maxAllowedBytes)}</span>
                </div>
                <input
                  type="range"
                  min={minMB}
                  max={maxMB}
                  value={Math.min(maxMB, Math.max(minMB, currentMB))}
                  onChange={(e) => handleSetSizeMB(Number(e.target.value))}
                  className="w-full accent-cyan-400 cursor-pointer h-2 bg-slate-800 rounded-lg"
                />
              </div>

              {/* Quick Preset Buttons */}
              <div className="space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-500">Quick Adjustments:</span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleSetSizeMB(minMB)}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-amber-300 rounded text-[10px] font-bold border border-slate-700"
                  >
                    Min Safe ({formatBytesHuman(validation.minAllowedBytes)})
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePresetDeltaMB(-500)}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-semibold border border-slate-700"
                  >
                    -500 MB
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePresetDeltaMB(500)}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-semibold border border-slate-700"
                  >
                    +500 MB
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePresetDeltaMB(1024)}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-semibold border border-slate-700"
                  >
                    +1 GB
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePresetDeltaMB(5 * 1024)}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-semibold border border-slate-700"
                  >
                    +5 GB
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSetSizeMB(maxMB)}
                    className="px-2.5 py-1 bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/40 text-cyan-300 rounded text-[10px] font-bold"
                  >
                    Max Available ({formatBytesHuman(validation.maxAllowedBytes)})
                  </button>
                </div>
              </div>

              {/* Validation Feedback Card */}
              {!validation.isValid ? (
                <div className="p-3 bg-red-950/50 border border-red-500/60 rounded-xl flex items-start gap-2.5 text-red-300 text-xs">
                  <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                  <div className="space-y-0.5">
                    <strong className="font-bold text-red-200">Validation Error:</strong>
                    <p className="text-[11px] leading-relaxed">{validation.error}</p>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-emerald-950/40 border border-emerald-500/40 rounded-xl space-y-1.5 text-xs text-emerald-300">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-bold">
                      <Check className="w-4 h-4 text-emerald-400" />
                      Valid Partition Size Adjustment
                    </span>
                    <span className="font-mono text-xs font-bold text-emerald-400">
                      Delta: {validation.deltaFormatted}
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-400 pt-1 border-t border-emerald-900/40">
                    <span>
                      New size: <strong className="text-slate-200">{formatBytesHuman(newSizeBytes)}</strong>
                    </span>
                    <span>
                      Free space after resize: <strong className="text-emerald-300">{formatBytesHuman(Math.max(0, currentLayoutAnalysis.unallocatedBytes - validation.deltaBytes))}</strong>
                    </span>
                  </div>
                  {validation.warning && (
                    <div className="text-[10px] text-amber-300 pt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                      <span>{validation.warning}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Flasher & CLI Command Preview */}
              {validation.suggestedCommands.length > 0 && (
                <div className="bg-black/70 p-3 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1.5">
                      <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                      Hardware Flashing & Resize Command
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const cmd = validation.suggestedCommands[activeCommandTab]?.command || '';
                        navigator.clipboard.writeText(cmd);
                        setCopiedCommand(true);
                        setTimeout(() => setCopiedCommand(false), 2000);
                      }}
                      className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors"
                    >
                      <Copy className="w-3 h-3" />
                      {copiedCommand ? 'Copied!' : 'Copy CLI'}
                    </button>
                  </div>

                  {/* Command tabs */}
                  <div className="flex gap-1 overflow-x-auto pb-1">
                    {validation.suggestedCommands.map((c, i) => (
                      <button
                        key={c.commandType}
                        type="button"
                        onClick={() => setActiveCommandTab(i)}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono whitespace-nowrap transition-colors ${
                          activeCommandTab === i 
                            ? 'bg-cyan-950 text-cyan-300 border border-cyan-500/40 font-bold' 
                            : 'bg-slate-900 text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        {c.commandType}
                      </button>
                    ))}
                  </div>

                  <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80 font-mono text-[11px] text-cyan-300 break-all select-all">
                    {validation.suggestedCommands[activeCommandTab]?.command}
                  </div>
                  <p className="text-[10px] text-slate-500 font-sans">
                    {validation.suggestedCommands[activeCommandTab]?.description}
                  </p>
                </div>
              )}

              {/* Actions Footer */}
              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setResizingPartition(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-colors text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleApplyResize}
                  disabled={!validation.isValid || validation.deltaBytes === 0}
                  className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl flex items-center gap-2 transition-all shadow-[0_0_15px_rgba(6,182,212,0.4)] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none text-xs uppercase tracking-wider"
                >
                  <Save className="w-4 h-4" /> Apply Resize
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Add Custom Partition Modal */}
      {showAddPartitionModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#070b12] border border-cyan-500/30 w-full max-w-md rounded-2xl shadow-2xl p-5 font-mono text-xs space-y-4">
            <div className="flex justify-between items-center pb-2.5 border-b border-slate-800">
              <span className="text-cyan-400 font-bold uppercase flex items-center gap-2">
                <Plus className="w-4 h-4" /> Create Custom Staging Partition
              </span>
              <button onClick={() => setShowAddPartitionModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 text-[11px] text-slate-400 flex justify-between">
              <span>Target Profile: <strong className="text-slate-200">{currentStorageProfile.name}</strong></span>
              <span>Available: <strong className="text-emerald-400">{formatBytesHuman(currentLayoutAnalysis.unallocatedBytes)}</strong></span>
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-400 block mb-1 uppercase">Partition Name</label>
              <input
                type="text"
                value={newPartName}
                onChange={(e) => setNewPartName(e.target.value)}
                placeholder="/custom, /carrier, /persist..."
                className="w-full bg-black/60 border border-slate-700 rounded-lg p-2.5 text-slate-200 font-mono focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-400 block mb-1 uppercase">Size (MB)</label>
              <input
                type="number"
                min={32}
                max={Math.floor(currentLayoutAnalysis.unallocatedBytes / (1024 * 1024))}
                value={newPartSizeMB}
                onChange={(e) => setNewPartSizeMB(Number(e.target.value))}
                className="w-full bg-black/60 border border-slate-700 rounded-lg p-2.5 text-cyan-300 font-mono focus:border-cyan-500 focus:outline-none"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">
                Equivalent: {formatBytesHuman(newPartSizeMB * 1024 * 1024)}
              </span>
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-400 block mb-1 uppercase">Filesystem</label>
              <select
                value={newPartFs}
                onChange={(e) => setNewPartFs(e.target.value as any)}
                className="w-full bg-black/60 border border-slate-700 rounded-lg p-2.5 text-slate-200 font-mono focus:border-cyan-500 focus:outline-none"
              >
                <option value="ext4">ext4 (Standard Android filesystem)</option>
                <option value="f2fs">f2fs (Flash-Friendly File System)</option>
                <option value="erofs">erofs (Enhanced Read-Only File System)</option>
                <option value="raw">raw (Raw image block)</option>
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button onClick={() => setShowAddPartitionModal(false)} className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg">
                Cancel
              </button>
              <button
                onClick={handleAddCustomPartition}
                disabled={!newPartName.trim() || newPartSizeMB <= 0 || newPartSizeMB * 1024 * 1024 > currentLayoutAnalysis.unallocatedBytes}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg flex items-center gap-1.5 disabled:opacity-40"
              >
                <Plus className="w-3.5 h-3.5" /> Allocate Partition
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
