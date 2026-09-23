# The upstream clamav/clamav images are published for amd64 only, and the free
# tier this deploys to is ARM. Debian packages ClamAV for both, so the scanner
# is built here instead.
FROM debian:12-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       clamav-daemon clamav-freshclam clamav ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /var/lib/clamav /run/clamav \
  && chown -R clamav:clamav /var/lib/clamav /run/clamav

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3310
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
