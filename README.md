# Email Direct

Email Direct est une plateforme privée de gestion de campagnes, de supervision SMTP et de délivrabilité. L’application utilise Lovable Cloud. Les agents KumoMTA et Mail-Tester communiquent avec elle via des API HTTPS authentifiées.

- [Application](https://mail-reputation-cloud.lovable.app)
- [Projet dans l’éditeur Lovable](https://lovable.dev/projects/ece3bccf-6e15-4bfe-ac67-ca95916b3d76)
- [Checklist de mise à jour pour Lovable](docs/LOVABLE-DEPLOY.md)
- [Guide de réinstallation et fichiers VPS](reinstallation-lovable/README.md)
- [Contrats d’API et réglages serveur](docs/CODEX.md)

## Développement local

```sh
npm install
npm run dev -- --host 127.0.0.1 --port 8080
npm run test
npm run build
```

Pour la configuration serveur, utiliser les secrets de l’environnement approprié. Les clés privilégiées restent côté serveur.
