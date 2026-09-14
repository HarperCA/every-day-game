function shouldPreserveCloudReminder(current) {
  return current && (current.delivery_status === 'sent' || current.delivery_status === 'queued');
}

function shouldDeleteCloudReminder(current, keepIds) {
  return Boolean(current) && !keepIds.has(current.id) && !shouldPreserveCloudReminder(current);
}

module.exports = { shouldDeleteCloudReminder, shouldPreserveCloudReminder };
