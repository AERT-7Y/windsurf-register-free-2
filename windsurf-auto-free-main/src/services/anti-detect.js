const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function log(msg) { console.log('[AntiDetect]', msg); }

function getStorageJsonPath() {
  return path.join(process.env.APPDATA, 'Windsurf', 'User', 'globalStorage', 'storage.json');
}

function getInstallationIdPath() {
  return path.join(process.env.USERPROFILE, '.codeium', 'windsurf', 'installation_id');
}

function generateHexId(length = 64) {
  return crypto.randomBytes(length / 2).toString('hex');
}

function generateUUID() {
  return crypto.randomUUID();
}

function generateSQMId() {
  return `{${crypto.randomUUID().toUpperCase()}}`;
}

function resetTelemetryIds() {
  const storagePath = getStorageJsonPath();
  
  if (!fs.existsSync(storagePath)) {
    log('storage.json not found, skipping telemetry reset');
    return { success: false, reason: 'file_not_found' };
  }

  try {
    const rawContent = fs.readFileSync(storagePath, 'utf8');
    const config = JSON.parse(rawContent);

    const oldIds = {
      machineId: config['telemetry.machineId'] || null,
      macMachineId: config['telemetry.macMachineId'] || null,
      devDeviceId: config['telemetry.devDeviceId'] || null,
      sqmId: config['telemetry.sqmId'] || null,
    };

    config['telemetry.machineId'] = generateHexId(64);
    config['telemetry.macMachineId'] = generateHexId(64);
    config['telemetry.devDeviceId'] = generateUUID();
    config['telemetry.sqmId'] = generateSQMId();

    const newIds = {
      machineId: config['telemetry.machineId'],
      macMachineId: config['telemetry.macMachineId'],
      devDeviceId: config['telemetry.devDeviceId'],
      sqmId: config['telemetry.sqmId'],
    };

    fs.writeFileSync(storagePath, JSON.stringify(config, null, 2), 'utf8');

    log('telemetry IDs reset successfully');
    log(`  machineId: ${maskId(oldIds.machineId)} -> ${maskId(newIds.machineId)}`);
    log(`  macMachineId: ${maskId(oldIds.macMachineId)} -> ${maskId(newIds.macMachineId)}`);
    log(`  devDeviceId: ${maskId(oldIds.devDeviceId)} -> ${maskId(newIds.devDeviceId)}`);
    log(`  sqmId: ${maskId(oldIds.sqmId)} -> ${maskId(newIds.sqmId)}`);

    return {
      success: true,
      old: oldIds,
      new: newIds,
    };
  } catch (e) {
    log(`failed to reset telemetry IDs: ${e.message}`);
    return { success: false, reason: e.message };
  }
}

function resetInstallationId() {
  const installIdPath = getInstallationIdPath();
  const dir = path.dirname(installIdPath);

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const oldId = fs.existsSync(installIdPath)
      ? fs.readFileSync(installIdPath, 'utf8').trim()
      : null;

    const newId = generateUUID();
    fs.writeFileSync(installIdPath, newId, 'utf8');

    log(`installation_id reset: ${maskId(oldId)} -> ${maskId(newId)}`);

    return { success: true, old: oldId, new: newId };
  } catch (e) {
    log(`failed to reset installation_id: ${e.message}`);
    return { success: false, reason: e.message };
  }
}

function setStorageReadOnly(readOnly = true) {
  const storagePath = getStorageJsonPath();
  
  if (!fs.existsSync(storagePath)) {
    return { success: false, reason: 'file_not_found' };
  }

  try {
    const { execSync } = require('child_process');
    
    if (readOnly) {
      execSync(`attrib +r "${storagePath}"`, { stdio: 'ignore' });
      log('storage.json set to read-only');
    } else {
      execSync(`attrib -r "${storagePath}"`, { stdio: 'ignore' });
      log('storage.json set to writable');
    }

    return { success: true };
  } catch (e) {
    log(`failed to change file attributes: ${e.message}`);
    return { success: false, reason: e.message };
  }
}

function maskId(id) {
  if (!id || id.length < 16) return id || 'null';
  return id.substring(0, 8) + '...' + id.substring(id.length - 6);
}

function fullReset() {
  log('starting full anti-detect reset...');
  
  const results = {
    telemetry: resetTelemetryIds(),
    installation: resetInstallationId(),
  };

  const allSuccess = results.telemetry.success && results.installation.success;
  
  log(`full reset ${allSuccess ? 'succeeded' : 'partially failed'}`);
  
  return {
    success: allSuccess,
    results,
  };
}

module.exports = {
  resetTelemetryIds,
  resetInstallationId,
  setStorageReadOnly,
  fullReset,
  getStorageJsonPath,
  getInstallationIdPath,
};
