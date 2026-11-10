FROM ubuntu:22.04
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl jq gnupg python3 python3-pip procps util-linux \
 && curl -fsSL https://openrepo.kumomta.com/kumomta-ubuntu-22/public.gpg | gpg --batch --dearmor -o /usr/share/keyrings/kumomta.gpg \
 && curl -fsSL https://openrepo.kumomta.com/files/kumomta-ubuntu22.list -o /etc/apt/sources.list.d/kumomta.list \
 && apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y kumomta && pip3 install --no-cache-dir zstandard==0.23.0

