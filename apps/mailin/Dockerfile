# mailin : réception SMTP des alertes terrain (voir server.py).
# Image publique, sans configuration : l'adresse acceptée et le certificat
# viennent du cluster (Secret chiffré, cert-manager).
FROM python:3.13-alpine
RUN pip install --no-cache-dir aiosmtpd==1.4.6 atpublic==5.1 attrs==25.4.0 \
 && adduser -D -H -u 101 mailin
COPY server.py /app/server.py
USER 101
EXPOSE 2525
ENTRYPOINT ["python3", "-u", "/app/server.py"]
