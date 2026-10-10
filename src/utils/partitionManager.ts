import { PartitionInfo } from '../types';

export interface DeviceStorageProfile {
  id: string;
  name: string;
  totalCapacityBytes: number;
  storageType: string;
  sectorSize: number;
  reservedOverheadBytes: number;
  description: string;
}

export const STORAGE_PROFILES: DeviceStorageProfile[] = [
  {
    id: 'ufs-128',
    name: '128 GB UFS 3.1 (Standard)',
    totalCapacityBytes: 128 * 1024 * 1024 * 1024, // 137,438,953,472 bytes (~128 GB)
    storageType: 'UFS 3.1 Flash',
    sectorSize: 4096,
    reservedOverheadBytes: 256 * 1024 * 1024, // 256 MB reserved for GPT / Bootloader / RPMB
    description: 'Modern standard flagship Android device layout with dynamic partitions'
  },
  {
    id: 'ufs-256',
    name: '256 GB UFS 4.0 (High Capacity)',
    totalCapacityBytes: 256 * 1024 * 1024 * 1024,
    storageType: 'UFS 4.0 Ultra-High Speed',
    sectorSize: 4096,
    reservedOverheadBytes: 256 * 1024 * 1024,
    description: 'High capacity storage layout for premium devices and custom ROM development'
  },
  {
    id: 'ufs-64',
    name: '64 GB UFS 2.2 / eMMC (Mid-Range)',
    totalCapacityBytes: 64 * 1024 * 1024 * 1024,
    storageType: 'UFS 2.2 Flash',
    sectorSize: 4096,
    reservedOverheadBytes: 256 * 1024 * 1024,
    description: 'Compact storage budget layout suitable for mainline Linux and GSI testing'
  },
  {
    id: 'emmc-32',
    name: '32 GB eMMC 5.1 (Legacy / Embedded)',
    totalCapacityBytes: 32 * 1024 * 1024 * 1024,
    storageType: 'eMMC 5.1 Storage',
    sectorSize: 512,
    reservedOverheadBytes: 128 * 1024 * 1024,
    description: 'Legacy Android partition layout for older boards and development kits'
  }
];

export const INITIAL_DEVICE_PARTITIONS: PartitionInfo[] = [
  {
    id: 'part_boot',
    name: '/boot',
    size: '64 MB',
    sizeBytes: 64 * 1024 * 1024,
    minSizeBytes: 16 * 1024 * 1024, // 16 MB min
    maxSizeBytes: 128 * 1024 * 1024, // 128 MB max physical block
    filesystem: 'raw',
    isMountableRW: false,
    isMountedRW: false,
    isDynamic: false,
    partitionType: 'Kernel Boot Image',
    description: 'Primary boot image containing Linux kernel Image, GKI modules & DTB'
  },
  {
    id: 'part_init_boot',
    name: '/init_boot',
    size: '16 MB',
    sizeBytes: 16 * 1024 * 1024,
    minSizeBytes: 8 * 1024 * 1024,
    maxSizeBytes: 64 * 1024 * 1024,
    filesystem: 'raw',
    isMountableRW: false,
    isMountedRW: false,
    isDynamic: false,
    partitionType: 'First-Stage Ramdisk',
    description: 'Android 13+ generic boot ramdisk containing early init binary and scripts'
  },
  {
    id: 'part_vendor_boot',
    name: '/vendor_boot',
    size: '32 MB',
    sizeBytes: 32 * 1024 * 1024,
    minSizeBytes: 16 * 1024 * 1024,
    maxSizeBytes: 128 * 1024 * 1024,
    filesystem: 'raw',
    isMountableRW: false,
    isMountedRW: false,
    isDynamic: false,
    partitionType: 'OEM Vendor Boot',
    description: 'Hardware vendor ramdisk, bootargs, and device-tree overlay (boot header v3/v4)'
  },
  {
    id: 'part_system',
    name: '/system',
    size: '3.8 GB',
    sizeBytes: Math.round(3.8 * 1024 * 1024 * 1024),
    minSizeBytes: 1024 * 1024 * 1024, // 1 GB minimum to boot AOSP
    filesystem: 'ext4',
    isMountableRW: true,
    isMountedRW: false,
    isDynamic: true,
    partitionType: 'Android Framework System',
    description: 'Android OS root filesystem, framework runtime, system binaries and ART'
  },
  {
    id: 'part_vendor',
    name: '/vendor',
    size: '1.6 GB',
    sizeBytes: Math.round(1.6 * 1024 * 1024 * 1024),
    minSizeBytes: 256 * 1024 * 1024, // 256 MB minimum for HALs
    filesystem: 'ext4',
    isMountableRW: true,
    isMountedRW: false,
    isDynamic: true,
    partitionType: 'Hardware HALs & Drivers',
    description: 'SoC proprietary HAL modules, camera blobs, audio drivers, and display services'
  },
  {
    id: 'part_product',
    name: '/product',
    size: '1.2 GB',
    sizeBytes: Math.round(1.2 * 1024 * 1024 * 1024),
    minSizeBytes: 256 * 1024 * 1024,
    filesystem: 'ext4',
    isMountableRW: true,
    isMountedRW: false,
    isDynamic: true,
    partitionType: 'Product Apps & Privileges',
    description: 'OEM product features, privileged apps, and localized device configurations'
  },
  {
    id: 'part_userdata',
    name: '/data',
    size: '105 GB',
    sizeBytes: 105 * 1024 * 1024 * 1024,
    minSizeBytes: 1024 * 1024 * 1024, // 1 GB minimum
    filesystem: 'f2fs',
    isMountableRW: true,
    isMountedRW: true,
    isDynamic: false,
    partitionType: 'User Data Storage',
    description: 'User applications, encrypted storage, internal sdcard and app databases'
  },
  {
    id: 'part_recovery',
    name: '/recovery',
    size: '64 MB',
    sizeBytes: 64 * 1024 * 1024,
    minSizeBytes: 16 * 1024 * 1024,
    maxSizeBytes: 128 * 1024 * 1024,
    filesystem: 'raw',
    isMountableRW: false,
    isMountedRW: false,
    isDynamic: false,
    partitionType: 'AOSP / TWRP Recovery',
    description: 'Standalone recovery system image used for OTA updates and emergency maintenance'
  }
];

export function formatBytesHuman(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = parseFloat((bytes / Math.pow(k, i)).toFixed(dm));
  return `${val} ${sizes[i]}`;
}

export function parseFormattedSizeToBytes(formatted: string): number {
  const parts = formatted.trim().split(/\s+/);
  if (parts.length < 2) {
    const num = parseFloat(formatted);
    return isNaN(num) ? 0 : num;
  }
  const value = parseFloat(parts[0]);
  const unit = parts[1].toUpperCase();
  if (isNaN(value)) return 0;

  switch (unit) {
    case 'GB':
      return Math.round(value * 1024 * 1024 * 1024);
    case 'MB':
      return Math.round(value * 1024 * 1024);
    case 'KB':
      return Math.round(value * 1024);
    case 'BYTES':
    case 'B':
      return Math.round(value);
    default:
      return Math.round(value * 1024 * 1024);
  }
}

export interface PartitionLayoutAnalysis {
  totalCapacityBytes: number;
  totalAllocatedBytes: number;
  unallocatedBytes: number;
  reservedOverheadBytes: number;
  allocationPercentage: number;
  freePercentage: number;
  isOverAllocated: boolean;
  overAllocatedBytes: number;
  partitionCount: number;
}

export function analyzeDeviceLayout(
  partitions: PartitionInfo[],
  deviceProfile: DeviceStorageProfile
): PartitionLayoutAnalysis {
  const totalAllocatedBytes = partitions.reduce((sum, p) => sum + (p.sizeBytes || parseFormattedSizeToBytes(p.size)), 0);
  const effectiveCapacity = deviceProfile.totalCapacityBytes - deviceProfile.reservedOverheadBytes;
  const unallocatedBytes = Math.max(0, effectiveCapacity - totalAllocatedBytes);
  const isOverAllocated = totalAllocatedBytes > effectiveCapacity;
  const overAllocatedBytes = isOverAllocated ? totalAllocatedBytes - effectiveCapacity : 0;
  const allocationPercentage = Math.min(100, (totalAllocatedBytes / deviceProfile.totalCapacityBytes) * 100);
  const freePercentage = Math.max(0, (unallocatedBytes / deviceProfile.totalCapacityBytes) * 100);

  return {
    totalCapacityBytes: deviceProfile.totalCapacityBytes,
    totalAllocatedBytes,
    unallocatedBytes,
    reservedOverheadBytes: deviceProfile.reservedOverheadBytes,
    allocationPercentage,
    freePercentage,
    isOverAllocated,
    overAllocatedBytes,
    partitionCount: partitions.length
  };
}

export interface ResizeValidationResult {
  isValid: boolean;
  error?: string;
  warning?: string;
  minAllowedBytes: number;
  maxAllowedBytes: number;
  unallocatedAvailableBytes: number;
  deltaBytes: number;
  deltaFormatted: string;
  isExpanding: boolean;
  isShrinking: boolean;
  suggestedCommands: {
    commandType: string;
    description: string;
    command: string;
  }[];
}

export function validatePartitionResize(
  partition: PartitionInfo,
  newSizeBytes: number,
  allPartitions: PartitionInfo[],
  deviceProfile: DeviceStorageProfile
): ResizeValidationResult {
  const currentBytes = partition.sizeBytes || parseFormattedSizeToBytes(partition.size);
  const minAllowedBytes = partition.minSizeBytes || Math.max(4 * 1024 * 1024, Math.round(currentBytes * 0.2));

  // Compute other partitions total allocated space
  const otherPartitionsTotal = allPartitions
    .filter(p => p.id !== partition.id)
    .reduce((sum, p) => sum + (p.sizeBytes || parseFormattedSizeToBytes(p.size)), 0);

  // Maximum permissible size for this partition within this device layout
  const effectiveDevicePool = deviceProfile.totalCapacityBytes - deviceProfile.reservedOverheadBytes;
  const maxPoolAvailable = Math.max(0, effectiveDevicePool - otherPartitionsTotal);
  
  // If partition has a hard hardware ceiling (e.g. boot fixed block 128MB), take min with that
  const maxAllowedBytes = partition.maxSizeBytes 
    ? Math.min(partition.maxSizeBytes, maxPoolAvailable)
    : maxPoolAvailable;

  const deltaBytes = newSizeBytes - currentBytes;
  const isExpanding = deltaBytes > 0;
  const isShrinking = deltaBytes < 0;
  const deltaFormatted = (deltaBytes >= 0 ? '+' : '') + formatBytesHuman(Math.abs(deltaBytes));

  const unallocatedAvailableBytes = maxPoolAvailable - currentBytes;

  // 1. Minimum bound check
  if (newSizeBytes < minAllowedBytes) {
    return {
      isValid: false,
      error: `Size (${formatBytesHuman(newSizeBytes)}) is smaller than the minimum safe capacity of ${formatBytesHuman(minAllowedBytes)} for ${partition.name}. Shrinking below this threshold will cause bootloops, mount failures, or data corruption.`,
      minAllowedBytes,
      maxAllowedBytes,
      unallocatedAvailableBytes,
      deltaBytes,
      deltaFormatted,
      isExpanding,
      isShrinking,
      suggestedCommands: []
    };
  }

  // 2. Hardware block limit check
  if (partition.maxSizeBytes && newSizeBytes > partition.maxSizeBytes) {
    return {
      isValid: false,
      error: `Size (${formatBytesHuman(newSizeBytes)}) exceeds the maximum hardware partition table ceiling of ${formatBytesHuman(partition.maxSizeBytes)} for ${partition.name}.`,
      minAllowedBytes,
      maxAllowedBytes,
      unallocatedAvailableBytes,
      deltaBytes,
      deltaFormatted,
      isExpanding,
      isShrinking,
      suggestedCommands: []
    };
  }

  // 3. Device layout capacity check
  if (newSizeBytes > maxPoolAvailable) {
    const excess = newSizeBytes - maxPoolAvailable;
    return {
      isValid: false,
      error: `Insufficient unallocated space on device layout! Request requires ${formatBytesHuman(newSizeBytes)}, but the device only has ${formatBytesHuman(unallocatedAvailableBytes)} unallocated free space. Exceeds layout by ${formatBytesHuman(excess)}.`,
      minAllowedBytes,
      maxAllowedBytes,
      unallocatedAvailableBytes,
      deltaBytes,
      deltaFormatted,
      isExpanding,
      isShrinking,
      suggestedCommands: []
    };
  }

  // 4. Zero or negative check
  if (newSizeBytes <= 0 || isNaN(newSizeBytes)) {
    return {
      isValid: false,
      error: 'Partition size must be a positive non-zero value.',
      minAllowedBytes,
      maxAllowedBytes,
      unallocatedAvailableBytes,
      deltaBytes,
      deltaFormatted,
      isExpanding,
      isShrinking,
      suggestedCommands: []
    };
  }

  // Warning if unallocated space becomes extremely low (< 500 MB)
  let warning: string | undefined;
  const remainingFreeAfter = maxPoolAvailable - newSizeBytes;
  if (remainingFreeAfter < 500 * 1024 * 1024 && isExpanding) {
    warning = `Device unallocated free pool will decrease to ${formatBytesHuman(remainingFreeAfter)}. Leave headroom for system updates and wear leveling.`;
  }

  // Block alignment check
  const remainder = newSizeBytes % deviceProfile.sectorSize;
  if (remainder !== 0) {
    warning = (warning ? warning + ' ' : '') + `Size is not aligned to the ${deviceProfile.sectorSize}-byte physical sector boundary. System will auto-align to nearest block.`;
  }

  // Build realistic flashing and resize commands
  const cleanName = partition.name.replace('/', '');
  const suggestedCommands = [];

  if (partition.isDynamic) {
    suggestedCommands.push({
      commandType: 'Fastboot Userspace (fastbootd)',
      description: 'Resize dynamic logical partition inside super group',
      command: `fastboot resize-logical-partition ${cleanName} ${newSizeBytes}`
    });
  } else {
    suggestedCommands.push({
      commandType: 'Fastboot GPT Raw',
      description: 'Update raw partition block size boundary',
      command: `fastboot oem partition resize ${cleanName} ${newSizeBytes}`
    });
  }

  if (partition.filesystem === 'ext4') {
    suggestedCommands.push({
      commandType: 'Linux Filesystem Resize',
      description: 'Resize ext4 filesystem structures (online/offline)',
      command: `e2fsck -f /dev/block/by-name/${cleanName} && resize2fs /dev/block/by-name/${cleanName} ${Math.floor(newSizeBytes / 1024)}K`
    });
  } else if (partition.filesystem === 'f2fs') {
    suggestedCommands.push({
      commandType: 'F2FS Flash Resize',
      description: 'Resize Flash-Friendly File System segment layout',
      command: `resize.f2fs -t ${Math.floor(newSizeBytes / 4096)} /dev/block/by-name/${cleanName}`
    });
  }

  suggestedCommands.push({
    commandType: 'Parted / GPT CLI',
    description: 'Respecify GPT partition end sector in Linux parted',
    command: `parted /dev/block/bootdevice resizepart $(parted /dev/block/bootdevice print | grep -w ${cleanName} | awk '{print $1}') ${Math.floor(newSizeBytes / (1024 * 1024))}MB`
  });

  return {
    isValid: true,
    warning,
    minAllowedBytes,
    maxAllowedBytes,
    unallocatedAvailableBytes,
    deltaBytes,
    deltaFormatted,
    isExpanding,
    isShrinking,
    suggestedCommands
  };
}
