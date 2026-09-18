#!/usr/bin/env bash
# SQLite 每日备份。自托管把数据可靠性的责任接了过来，备份不是可选项。
#
# 用 sqlite3 的 .backup 而不是直接 cp：WAL 模式下直接复制文件可能拿到
# 写了一半的状态，.backup 会拿一致性快照。
#
# 保留 14 天，够覆盖「上周误删了什么」这类回溯需求，又不会把磁盘塞满。
set -euo pipefail

DB="/opt/daily-contest/server/data/app.db"
DIR="/opt/daily-contest/backups"
STAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "$DIR"
chmod 700 "$DIR"

sqlite3 "$DB" ".backup '$DIR/app-$STAMP.db'"
gzip -f "$DIR/app-$STAMP.db"
chmod 600 "$DIR/app-$STAMP.db.gz"

# 清掉 14 天前的
find "$DIR" -name 'app-*.db.gz' -mtime +14 -delete

echo "$(date -Iseconds) 备份完成 app-$STAMP.db.gz（现存 $(ls -1 "$DIR"/app-*.db.gz 2>/dev/null | wc -l) 份）"
