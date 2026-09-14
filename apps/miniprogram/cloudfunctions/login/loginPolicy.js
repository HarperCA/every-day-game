function requireActiveAccount(account) {
  if (!account || account.status !== 'active') throw new Error('user_account_disabled');
  return account;
}

module.exports = { requireActiveAccount };
