# Carreira em Jogo — versão web

Versão digital do jogo de tabuleiro **Carreira em Jogo** (SENAI Videira · Mundo SENAI 2026), implementada a partir da documentação dos alunos de Aprendizagem Industrial em Assistente Administrativo. O jogo acontece todo neste sistema: não há tabuleiro nem dado físico.

```bash
npm install
npm start      # http://localhost:3000
npm test
```

| Perfil | E-mail | Senha inicial |
|---|---|---|
| Administrador (docente) | professor@senai.com.br | admin123 |
| Mediador (aluno) | mediador@senai.com.br | mediador123 |

Requer Node.js 22.13 ou superior (usa o SQLite embutido `node:sqlite`). O banco `data/carreira.db` é criado e populado só na primeira execução (o que o administrador excluir não volta ao reiniciar); para recomeçar do zero, pare o servidor e apague `data/carreira.db*`.

## Ao rodar a fase 2

- **Banco da fase 1 é recusado.** O schema mudou e não há migração: com um banco antigo, o servidor não sobe e o erro diz `é da fase 1 e não é migrado`. Pare o servidor e mova para outra pasta (por exemplo, `data/backup-fase1/`) os três arquivos, `data/carreira.db`, `data/carreira.db-wal` e `data/carreira.db-shm`, ou os que existirem. Não mova só o `.db`: os dados mais recentes podem estar no `-wal`, e o SQLite descarta esse arquivo ao criar o banco novo. Na próxima subida nasce um banco novo, com as senhas iniciais da tabela acima (ou as de `SENHA_ADMIN` e `SENHA_MEDIADOR`).
- **Logo do SENAI.** O arquivo oficial não vem no projeto: coloque-o em `public/img/logo-senai.png`. Sem ele, o certificado sai com o texto "SENAI".
- **Certificado.** Depois do fim da partida, o link **Certificado** de cada jogador abre a página para imprimir ou salvar em PDF; o nome sugerido é `Certificado - Nome - Cargo`. Salvar na pasta compartilhada e enviar continua manual. Só o administrador vê o e-mail do jogador.

As regras do jogo também mudaram na fase 2 (dado, casa amarela sem pergunta, alternativas, rotas, Casa da Morte e cargos): a especificação técnica abre com a lista.

- **Documentação consolidada** (estudo de toda a documentação dos alunos, decisões e pendências): [docs/DOCUMENTACAO-CONSOLIDADA.md](docs/DOCUMENTACAO-CONSOLIDADA.md)
- **Especificação técnica** (o sistema atual: rotas, API, regras do motor, decisões da fase 2 e riscos medidos): [docs/ESPECIFICACAO-TECNICA.md](docs/ESPECIFICACAO-TECNICA.md)
- Documentação original dos alunos: pasta [docs/](docs/)
