#!/bin/sh
# Debian configures clamd for a local unix socket; the backend reaches it over
# TCP from another container, so the config is written here rather than shipped.
set -eu

cat > /etc/clamav/clamd.conf <<CONF
Foreground yes
LogTime yes
LogSyslog no
DatabaseDirectory /var/lib/clamav
User clamav
TCPSocket 3310
TCPAddr 0.0.0.0
MaxThreads 4
# Uploads are capped at 25 MiB and streamed to clamd whole, so these ceilings
# sit above that. A stream over the limit is refused rather than scanned, which
# the backend would report as a scan failure.
StreamMaxLength 32M
MaxFileSize 32M
MaxScanSize 128M
CONF

cat > /etc/clamav/freshclam.conf <<CONF
DatabaseDirectory /var/lib/clamav
DatabaseOwner clamav
DatabaseMirror database.clamav.net
LogSyslog no
NotifyClamd /etc/clamav/clamd.conf
# Four checks a day is the mirrors' guidance for a single small deployment.
Checks 4
CONF

chown -R clamav:clamav /var/lib/clamav /run/clamav

# clamd refuses to start without a signature database, so the first run blocks
# until one is present. This takes a few minutes and only happens once, because
# the database lives on a named volume.
if [ ! -e /var/lib/clamav/main.cvd ] && [ ! -e /var/lib/clamav/main.cld ]; then
  echo "Downloading virus signatures for the first time; this takes a while."
  freshclam --foreground --stdout
fi

# Keep signatures current alongside the daemon.
freshclam -d &

exec clamd
