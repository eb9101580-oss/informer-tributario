# Alertas por e-mail

O Informer usa o Resend para enviar a confirmação do cadastro e os alertas de publicações com nota 8 ou superior. O monitor automático não envia mensagens duplicadas: cada alerta é marcado depois do envio.

## Configuração

1. Crie uma conta em [resend.com](https://resend.com) e gere uma API key.
2. Verifique o domínio ou endereço que será usado como remetente.
3. Cadastre os dois valores no projeto Vercel (Production) e nos secrets do GitHub Actions:

   - `RESEND_API_KEY`: a chave `re_...` do Resend;
   - `ALERTS_FROM_EMAIL`: por exemplo `Informer Tributário <alertas@seudominio.com.br>`.

No PowerShell, sem colocar a chave no código:

```powershell
$env:RESEND_API_KEY = 're_...'
$env:ALERTS_FROM_EMAIL = 'Informer Tributário <alertas@seudominio.com.br>'
vercel.cmd env add RESEND_API_KEY production --value $env:RESEND_API_KEY --sensitive --yes
vercel.cmd env add ALERTS_FROM_EMAIL production --value $env:ALERTS_FROM_EMAIL --yes
gh.exe secret set RESEND_API_KEY --repo eb9101580-oss/informer-tributario --body $env:RESEND_API_KEY
gh.exe secret set ALERTS_FROM_EMAIL --repo eb9101580-oss/informer-tributario --body $env:ALERTS_FROM_EMAIL
```

Depois, faça um novo deploy da Vercel. A tela **Configurações** mostrará `Envio de alertas ativo` quando a API e a persistência estiverem prontas.
