#!/usr/bin/env python3
"""Serveur local du jeu, visible des téléphones branchés sur le même Wi-Fi.

    python3 serve.py

Il affiche au démarrage l'adresse à ouvrir sur les téléphones ; la page ouverte sur cet
ordinateur (http://localhost:8790) montre la même adresse en QR code.
Seuls les fichiers du jeu sont servis (index.html, le dossier js et les discussions d'exemple
du dossier samples) : rien d'autre du dossier n'est accessible depuis le réseau.
Il désactive le cache du navigateur : chaque rechargement de la page prend la dernière
version des fichiers du jeu.
"""
import http.server
import json
import os
import re
import signal
import socket
import subprocess
import sys
import time
from urllib.parse import unquote

PORT = int(os.environ.get('PORT', 8790))
ALLOWED = re.compile(r'^/(index\.html)?$|^/js/[A-Za-z0-9_.-]+\.js$|^/samples/[^/]+\.(txt|zip)$')


class GameServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = True   # redémarrage immédiat, sans attendre la fin du TIME_WAIT


class GameHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?', 1)[0] == '/lan.json':   # adresse réseau, pour le QR code de la page d'accueil
            ip = lan_address()
            body = json.dumps({'url': f'http://{ip}:{PORT}/' if ip else None}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def send_head(self):
        path = unquote(self.path.split('?', 1)[0].split('#', 1)[0])
        if not ALLOWED.match(path) or '..' in path:
            self.send_error(404, 'Not found')
            return None
        return super().send_head()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def log_message(self, fmt, *args):   # pas une ligne par fichier servi
        pass


def take_over_port():
    """Si une ancienne instance de CE script tient encore le port (serveur oublié,
    relance depuis l'app), on l'arrête proprement avant de démarrer : lancer le
    serveur doit toujours réussir."""
    try:
        out = subprocess.run(['lsof', '-t', f'-iTCP:{PORT}', '-sTCP:LISTEN'],
                             capture_output=True, text=True, timeout=5).stdout.split()
    except (OSError, subprocess.SubprocessError):
        return
    for pid in map(int, out):
        if pid == os.getpid():
            continue
        try:
            cmd = subprocess.run(['ps', '-p', str(pid), '-o', 'command='],
                                 capture_output=True, text=True, timeout=5).stdout
        except (OSError, subprocess.SubprocessError):
            continue
        if 'serve.py' not in cmd:
            print(f'Le port {PORT} est occupé par un autre programme (PID {pid}) : {cmd.strip()}', flush=True)
            sys.exit(1)
        print(f'Ancienne instance du serveur (PID {pid}) arrêtée.', flush=True)
        os.kill(pid, signal.SIGTERM)
    for _ in range(50):                       # jusqu'à 5 s pour que le port se libère
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            if probe.connect_ex(('127.0.0.1', PORT)) != 0:
                return
        time.sleep(0.1)


def lan_address():
    """Adresse de cet ordinateur sur le réseau local (aucun paquet n'est réellement envoyé)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    ip = lan_address()
    print(f"Who is bro ? : http://localhost:{PORT}", flush=True)
    print(f'Sur les téléphones (même Wi-Fi) : http://{ip}:{PORT}' if ip
          else 'Réseau local : adresse introuvable (Wi-Fi coupé ?)', flush=True)
    take_over_port()
    GameServer(('0.0.0.0', PORT), GameHandler).serve_forever()
