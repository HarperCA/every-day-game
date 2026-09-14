function normalizeStateVersion(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function nextStateVersion(id, currentVersion, expectedVersion) {
  const current = normalizeStateVersion(currentVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    throw new Error('invalid_expected_version');
  }
  if (expectedVersion !== current) {
    throw new Error(`state_version_conflict:${id}:${current}`);
  }
  return current + 1;
}

module.exports = { nextStateVersion, normalizeStateVersion };
