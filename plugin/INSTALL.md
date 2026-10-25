# Paquet local Fairy Tail

Le paquet fournit trois compétences et une configuration MCP stdio locale.
Le serveur se lance avec `bun <dépôt>/apps/mcp/main.ts`. Aucun service HTTP
public, identifiant de compte, icône distante ou installation globale n'est créé.

Les descripteurs `.codex-plugin/plugin.json` et `.claude-plugin/plugin.json`
pointent vers `skills/` et `.mcp.json`. `openai/` fournit également un manifeste
Agent Plugins avec les mêmes compétences et un `mcp.json` stdio.

Les fichiers MCP contiennent les chemins absolus du checkout lors de leur
génération : le lancement ne dépend donc pas du dossier courant du client.
Après déplacement du dépôt, régénérer uniquement ce paquet :

```powershell
bun plugin/scripts/configure.ts
bun plugin/scripts/configure.ts --check
```

La commande ne modifie aucune configuration de compte ou de client. La présence
de ces fichiers ne prouve pas que le paquet est installé dans une application.
Utiliser le parcours d'ajout de plugin local du client cible et tester sa liste
d'outils dans une nouvelle conversation.

Le dossier `openai/` dépend toujours du serveur du checkout : il n'embarque ni
le runtime ni le corpus. Ses compétences et références sont synchronisées par
le générateur pour rester lisibles dans un paquet distinct.
