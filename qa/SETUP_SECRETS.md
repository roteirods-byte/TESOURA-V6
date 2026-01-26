# TESOURA-V6 — Secrets necessários (GitHub)

No repositório: **Settings → Secrets and variables → Actions → New repository secret**

Crie 3 secrets:

1) **TESOURA_VM_HOST**  
- Valor: IP público da VM tesoura-sql (ex: 136.119.81.83)

2) **TESOURA_VM_USER**  
- Valor: roteiro_ds

3) **TESOURA_VM_SSH_KEY**  
- Valor: a chave **privada** inteira (começa com: `-----BEGIN ... PRIVATE KEY-----`)

Depois: **Actions → Deploy TESOURA-V6 na VM (tesoura-sql) → Run workflow**.
