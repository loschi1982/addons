# Alpine 3.20 bringt Python 3.12 mit (siehe build.yaml).
ARG BUILD_FROM=alpine:3.20
FROM ${BUILD_FROM}

# Python 3.12 + pip
RUN apk add --no-cache python3 py3-pip

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip3 install --break-system-packages --no-cache-dir -r /app/requirements.txt

COPY app/ /app/app/
COPY run.sh /run.sh
# CRLF -> LF absichern (falls unter Windows ausgecheckt) und ausführbar machen
RUN sed -i 's/\r$//' /run.sh && chmod +x /run.sh

CMD ["/run.sh"]
