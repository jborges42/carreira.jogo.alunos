# Documento de requisitos funcionais (RF).

| Código | Módulo | Descrição do Requisito Funcional |
| :---- | :---- | :---- |
| **RF01** | Cadastro | O sistema deve permitir o cadastro de novos jogadores informando nome, e-mail e escola de origem. |
| **RF02** | Cadastro | O sistema deve permitir o cadastro prévio das escolas visitantes. |
| **RF03** | Partida | O sistema deve permitir que o Mediador inicie uma nova partida vinculando de 1 a 4 jogadores cadastrados. |
| **RF04** | Partida | O sistema deve permitir que o Mediador insira o valor tirado no dado físico (de 1 a 6\) para o jogador da vez. |
| **RF05** | Jogo | O sistema deve sortear e exibir aleatoriamente uma pergunta de acordo com a categoria/cor da casa em que o jogador parou. |
| **RF06** | Jogo | O sistema deve impedir que a mesma pergunta seja sorteada mais de uma vez durante a mesma partida. |
| **RF07** | Jogo | O sistema deve fornecer botões para o Mediador registrar se a resposta verbal do jogador foi "Correta" ou "Incorreta". |
| **RF08** | Estoque | O sistema deve registrar a entrega do brinde (chaveiro) ao final da partida, de acordo com a pontuação/casa atingida pelo jogador. |
| **RF09** | Estoque | O sistema deve decrementar automaticamente 1 unidade do banco de dados do estoque de chaveiros assim que o brinde for entregue. |
| **RF10** | Admin | O sistema deve permitir que o usuário com perfil Administrador (Docente) insira, edite e exclua perguntas do banco de dados. |

| RF01 | Cadastro | O sistema deve permitir o cadastro de novos jogadores informando nome, e-mail e escola de origem. |
| :---- | :---- | :---- |

**Campos da Tela:**

* **Nome Completo:** Obrigatório.  
* **E-mail:** Opcional.  
* **Escola de Origem:** Obrigatório (selecionar de uma lista).

**Regras de Funcionamento:**

* **Preenchimento obrigatório:** O sistema não deixa salvar se o Nome ou a Escola estiverem em branco.  
* **Validação de E-mail:** Se o e-mail for preenchido, o sistema confere se tem o formato certo (com o "@").  
* **Escola padronizada:** O mediador não pode digitar a escola, deve apenas escolher na lista. Isso evita erros de digitação e problemas no relatório final.  
* **Agilidade na fila:** Ao clicar em "Salvar", o sistema exibe um aviso de sucesso e limpa os campos automaticamente para cadastrar a próxima pessoa.

INSERT INTO TB\_JOGADOR (nome, email, id\_escola) VALUES ('Nome', 'email@email.com', 1);

| RF02 | Cadastro | O sistema deve permitir o cadastro prévio das escolas visitantes. |
| :---- | :---- | :---- |

**Campos da Tela:**

* **Nome da Escola:** Obrigatório.  
* **Cidade:** Obrigatório.

**Regras de Funcionamento:**

* **Preenchimento obrigatório:** O sistema não deixa salvar se o nome da escola ou a cidade estiverem em branco.  
* **Sem repetição:** O sistema não permite cadastrar duas escolas exatamente com o mesmo nome para evitar confusão nos relatórios.  
* **Ajustes:** O administrador pode ver a lista de escolas cadastradas, arrumar o nome se tiver algum erro de digitação ou apagar.

INSERT INTO TB\_ESCOLA (nome, cidade) VALUES ('Nome da Escola', 'Nome da Cidade');

| RF03 | Partida | O sistema deve permitir que o Mediador inicie uma nova partida vinculando de 1 a 4 jogadores cadastrados. |
| :---- | :---- | :---- |

**Campos da Tela:**

* **Seleção de Jogadores:** Obrigatório (escolher os nomes na lista de pessoas que já foram cadastradas no RF01).

**Regras de Funcionamento:**

* **Quantidade de participantes:** O sistema exige que a partida tenha no mínimo 1 jogador e no máximo 4 jogadores.  
* **Sem repetição na mesma rodada:** O sistema bloqueia se o mediador tentar selecionar a mesma pessoa duas vezes para a mesma partida.  
* **Mudança de Status:** Ao clicar em "Iniciar", o sistema muda o status daquela rodada para "Em Andamento" e libera a tela para o sorteio dos dados.

INSERT INTO TB\_PARTIDA (status) VALUES ('Em Andamento');

| RF04 | Partida | O sistema deve permitir que o Mediador insira o valor tirado no dado físico (de 1 a 6\) para o jogador da vez. |
| :---- | :---- | :---- |

**Campos da Tela:**

* **Valor do Dado:** Obrigatório (o ideal é usar 6 botões grandes numerados de 1 a 6 na tela para agilizar o clique no tablet/computador).

**Regras de Funcionamento:**

* **Controle de Turno:** O sistema deve mostrar claramente o nome de qual jogador é a vez de lançar o dado.  
* **Limite do dado:** O sistema só permite inserir valores de 1 a 6 (como em um dado real). Letras ou outros números são bloqueados.  
* **Cálculo Automático:** Ao confirmar o número, o sistema soma o valor do dado com a posição atual do jogador para descobrir em qual casa do tabuleiro ele vai parar (ex: estava na casa 2, tirou 4, vai para a casa 6).

\-- O sistema calcula a casa final e prepara o registro da jogada  
INSERT INTO TB\_JOGADA (id\_partida, id\_jogador, casa\_final) VALUES (1, 2, 6);

| RF05 | Jogo | O sistema deve sortear e exibir aleatoriamente uma pergunta de acordo com a categoria/cor da casa em que o jogador parou. |
| :---- | :---- | :---- |

**Campos da Tela:**

* **Texto da Pergunta:** Exibição grande na tela para o mediador ler.  
* **Categoria/Cor:** Indicação visual na tela (ex: fundo da tela muda para a cor da categoria sorteada).  
* **Resposta Correta:** Um campo oculto ou destacado que mostra ao mediador qual é a resposta certa.

**Regras de Funcionamento:**

* **Sorteio automático:** O mediador não escolhe a pergunta, o sistema sorteia aleatoriamente de acordo com a categoria vinculada à casa do tabuleiro.  
* **Apoio visual:** A tela deve destacar a cor da categoria (Vermelho, Verde, Azul ou Amarelo) para confirmar que a pergunta bate com a casa onde o jogador físico parou.  
* **Gabarito visível:** O sistema já deve mostrar a resposta correta na tela para o mediador saber se o jogador vai acertar ou errar quando responder.

SELECT enunciado, resposta FROM TB\_PERGUNTA   
WHERE id\_categoria \= 2   
ORDER BY RANDOM() LIMIT 1;

| RF06 | Jogo | O sistema deve impedir que a mesma pergunta seja sorteada mais de uma vez durante a mesma partida. |
| :---- | :---- | :---- |

**Regras de Funcionamento:**

* **Histórico da partida:** O sistema "lembra" de todas as perguntas que já foram sorteadas desde o início daquela partida específica.  
* **Filtro no sorteio:** Antes de exibir a próxima pergunta na tela (no RF05), o sistema exclui da lista de opções as perguntas que já foram usadas.  
* **Segurança contra repetição:** Mesmo que os jogadores caiam várias vezes nas casas da mesma cor (ex: Azul), eles sempre receberão perguntas inéditas sobre aquele tema.

SELECT id\_pergunta, enunciado, resposta FROM TB\_PERGUNTA   
WHERE id\_categoria \= 3   
AND id\_pergunta NOT IN (SELECT id\_pergunta FROM TB\_JOGADA WHERE id\_partida \= 1\)  
ORDER BY RANDOM() LIMIT 1;

| RF07 | Jogo | O sistema deve fornecer botões para o Mediador registrar se a resposta verbal do jogador foi "Correta" ou "Incorreta". |
| :---- | :---- | :---- |

**Campos da Tela:**

* **Botão "Correta":** Geralmente na cor verde, para aprovar a resposta.  
* **Botão "Incorreta":** Geralmente na cor vermelha, para reprovar a resposta.

**Regras de Funcionamento:**

* **Ação do Mediador:** O mediador compara a resposta falada pelo jogador com o gabarito que está aparecendo na tela.  
* **Avanço no Tabuleiro:** Se o botão "Correta" for clicado, o sistema confirma o avanço do peão e registra os pontos. Se "Incorreta" for clicado, o jogador não ganha os pontos (ou recua uma casa, dependendo da regra do tabuleiro físico).  
* **Fim de Turno:** O clique em um dos botões é obrigatório para encerrar a jogada daquela pessoa e passar a vez para o próximo jogador da lista.

\-- Exemplo salvando que o jogador acertou a pergunta (acertou \= 1\)  
INSERT INTO TB\_JOGADA (id\_partida, id\_jogador, id\_pergunta, acertou, casa\_final)   
VALUES (1, 2, 45, 1, 6);

| RF08 | Estoque | O sistema deve registrar a entrega do brinde (chaveiro) ao final da partida, de acordo com a pontuação/casa atingida pelo jogador. |
| :---- | :---- | :---- |

**Campos da Tela:**

* **Resumo do Jogador: Exibição do nome e da casa final em que o peão parou.**  
* **Nível do Brinde: Indicação clara de qual chaveiro o mediador deve pegar na mesa (ex: Chaveiro Nível Iniciante, Intermediário ou Avançado).**  
* **Botão "Confirmar Entrega": Obrigatório para oficializar que o jogador recebeu o souvenir.**

**Regras de Funcionamento:**

* **Cálculo Automático: O mediador não precisa decorar as regras de pontuação. O sistema avalia automaticamente a `casa_final` do jogador e vincula ao brinde correspondente.**  
* **Controle de Duplicidade: O sistema só permite registrar a entrega de um brinde por jogador por partida, evitando que a mesma pessoa receba premiações duplicadas.**  
* **Encerramento Obrigatório: A partida só é considerada 100% finalizada no sistema após o mediador confirmar a tela de premiação de todos os participantes daquela rodada.**

**INSERT INTO TB\_ENTREGA\_BRINDE (id\_jogador, id\_brinde)**   
**VALUES (2, 3); \-- O jogador de ID 2 recebeu o brinde de ID 3**

| RF09 | Estoque | O sistema deve decrementar automaticamente 1 unidade do banco de dados do estoque de chaveiros assim que o brinde for entregue. |
| :---- | :---- | :---- |

**Regras de Funcionamento:**

* **Tempo Real: A cada entrega confirmada, a contagem de brindes disponíveis diminui imediatamente. Se havia 100 chaveiros nível "Iniciante", passa para 99 instantaneamente.**  
* **Alerta de Estoque Zero: Se a quantidade de um determinado chaveiro chegar a zero, o sistema não pode tentar dar baixa e deve avisar na tela do mediador que aquele modelo esgotou (impedindo erros de entregar algo que não existe fisicamente na mesa).**  
* **Substituição do Papel: Elimina a necessidade de o aluno Assistente Administrativo ter que fazer "pauzinhos" em um papel ou preencher planilhas paralelas para controlar o que foi entregue.**

**UPDATE TB\_BRINDE**   
**SET quantidade\_estoque \= quantidade\_estoque \- 1**   
**WHERE id\_brinde \= 3; \-- Desconta 1 unidade do brinde de ID 3**

| RF10 | Admin | O sistema deve permitir que o usuário com perfil Administrador (Docente) insira, edite e exclua perguntas do banco de dados. |
| :---- | :---- | :---- |

**Campos da Tela:**

* **Enunciado da Pergunta: Área de texto obrigatória.**  
* **Resposta (Gabarito): Área de texto obrigatória.**  
* **Categoria: Lista de seleção (menu dropdown) com os 4 temas do jogo (Ética, Finanças, Rotinas ou Gestão do Tempo).**  
* **Botões de Ação: Salvar (Novo), Editar e Excluir.**

**Regras de Funcionamento:**

* **Acesso Restrito: Esta tela não pode ser acessada pelos alunos que são os "Aprendizes Mediadores". Apenas o professor tem acesso.**  
* **Preenchimento Completo: O sistema não salva uma pergunta se o enunciado, a resposta ou a categoria estiverem em branco.**  
* **Edição em Tempo Real: Qualquer alteração feita em uma pergunta pelo professor passa a valer imediatamente para as próximas partidas iniciadas no tabuleiro.**

**\-- Para INSERIR uma nova pergunta:**  
**INSERT INTO TB\_PERGUNTA (enunciado, resposta, id\_categoria)**   
**VALUES ('O que é a sigla CLT?', 'Consolidação das Leis do Trabalho', 3);**

**\-- Para EDITAR (atualizar) uma pergunta existente:**  
**UPDATE TB\_PERGUNTA**   
**SET enunciado \= 'O que significa a sigla CLT?'**   
**WHERE id\_pergunta \= 10;**

**\-- Para EXCLUIR uma pergunta do jogo:**  
**DELETE FROM TB\_PERGUNTA**   
**WHERE id\_pergunta \= 10;**

# Documento de requisitos não funcionais (RNF).

| Código | Categoria | Descrição do Requisito Não Funcional |
| :---- | :---- | :---- |
| **RNF01** | Usabilidade | O sistema deve possuir uma interface responsiva, adaptando-se perfeitamente às telas de tablets e notebooks usados pelos mediadores no evento. |
| **RNF02** | Usabilidade | A interface do sorteio de perguntas deve ter botões grandes e fontes de alta legibilidade, facilitando a leitura rápida do mediador em pé. |
| **RNF03** | Desempenho | O sistema deve sortear e exibir a pergunta na tela (RF05) em um tempo máximo de 2 segundos, para não quebrar a dinâmica do jogo físico. |
| **RNF04** | Segurança | O sistema deve ter controle de acesso (login): Mediadores acessam apenas a operação do jogo; apenas Administradores acessam o painel de edição de perguntas e escolas. |
| **RNF05** | Portabilidade | O sistema deve ser acessível via navegadores web padrão (Google Chrome, Firefox, Edge) sem a necessidade de instalação de aplicativos no dispositivo. |
| **RNF06** | Confiabilidade | O banco de dados deve garantir a integridade das informações da partida, não perdendo a pontuação atual dos jogadores caso a página seja atualizada sem querer. |

| RNF01 | Usabilidade | O sistema deve possuir uma interface responsiva, adaptando-se perfeitamente às telas de tablets e notebooks usados pelos mediadores no evento. |
| :---- | :---- | :---- |

**RNF01 \- Interface Responsiva (Tablets e Notebooks)**

**O que é: O design do sistema (textos, botões e formulários) deve se ajustar e se reorganizar automaticamente para caber perfeitamente no tamanho da tela do aparelho que o mediador estiver usando, sem distorcer as imagens ou esconder botões. Categoria: Usabilidade.**

**Por que é necessário: Durante o evento Mundo SENAI, os Aprendizes Mediadores estarão de pé ao redor de um tabuleiro gigante de 3x3 metros. Eles usarão os equipamentos disponíveis no dia (que podem ser notebooks nas mesas de apoio ou tablets na mão). O sistema precisa ser fácil de ler e operar em qualquer um desses aparelhos.**

**Regras de Funcionamento (Como testar):**

* **Sem barra de rolagem lateral: O sistema nunca deve exigir que o usuário role a tela para a direita ou esquerda para conseguir ver uma pergunta inteira. Tudo deve caber na largura da tela.**  
* **Adaptação ao Toque (Touchscreen): Quando aberto em um tablet, os botões (como o de Iniciar Partida ou de Resposta Correta/Incorreta) devem ter um tamanho adequado para serem tocados com o dedo, evitando cliques acidentais.**  
* **Reorganização: Se a tela for larga (notebook), as informações podem ficar lado a lado. Se a tela for estreita (tablet em pé), as informações devem se empilhar uma embaixo da outra automaticamente.**

**/\* Exemplo de uso de Media Queries no CSS para adaptar a tela \*/**  
**@media (max-width: 768px) {**  
  **/\* Regras de design específicas para quando for usado em um Tablet \*/**  
  **.botao-resposta {**  
    **width: 100%; /\* O botão ocupa a tela toda para facilitar o clique \*/**  
    **font-size: 20px; /\* Aumenta a letra da pergunta \*/**  
  **}**  
**}**

| RNF02 | Usabilidade | A interface do sorteio de perguntas deve ter botões grandes e fontes de alta legibilidade, facilitando a leitura rápida do mediador em pé. |
| :---- | :---- | :---- |

**RNF02 \- Legibilidade e Botões Grandes (Acessibilidade Visual)**

**O que é: O layout da tela de sorteio e de perguntas deve usar letras grandes e botões com cores de alto contraste (fáceis de diferenciar).Categoria: Usabilidade.**

**Por que é necessário: O mediador estará em pé, muitas vezes segurando o tablet com uma mão e lendo a pergunta em voz alta para os jogadores. Ele não pode perder tempo "procurando" onde clicar ou forçando a vista para ler letras pequenas no meio da barulheira do evento Mundo SENAI.**

**Regras de Funcionamento (Como testar):**

* **Tamanho da Fonte: O texto das perguntas (RF05) deve ser a informação com maior destaque na tela.**  
* **Cores de Ação: Os botões de decisão devem usar cores universais e claras (exemplo: Botão "Correta" em Verde, Botão "Incorreta" em Vermelho).**  
* **Espaçamento: Os botões devem ter um espaço vazio entre eles para evitar que o mediador esbarre o dedo e clique no botão errado sem querer.**

**/\* Exemplo de formatação no CSS para garantir botões grandes e legíveis \*/**  
**.botao-correta {**  
  **background-color: \#28a745; /\* Verde padrão \*/**  
  **font-size: 24px; /\* Letra grande \*/**  
  **padding: 15px 30px; /\* Área de clique espaçosa \*/**  
**}**

| RNF03 | Desempenho | O sistema deve sortear e exibir a pergunta na tela (RF05) em um tempo máximo de 2 segundos, para não quebrar a dinâmica do jogo físico. |
| :---- | :---- | :---- |

**RNF03 \- Tempo de Resposta Rápido (Desempenho)**

**O que é: O sistema não pode travar ou ficar "pensando" por mais de 2 segundos quando o mediador realizar uma ação (como sortear a pergunta ou confirmar a entrega do chaveiro).Categoria: Desempenho.**

**Por que é necessário: O "Carreira em Jogo" é uma experiência ao vivo. Se o sistema demorar para processar cada jogada, o jogo físico no tabuleiro fica chato, a fila de espera aumenta e os alunos perdem o interesse.**

**Regras de Funcionamento (Como testar):**

* **Sorteio Imediato: Ao clicar em "Sortear Pergunta", o texto deve aparecer na tela quase instantaneamente.**  
* **Feedback Visual: Se a internet do evento oscilar e o sistema levar mais de 1 segundo para carregar, ele deve exibir um ícone de carregamento (spinner/ampulheta) para o mediador saber que o sistema está trabalhando e não travou.**

**\-- Uso do LIMIT 1 para garantir que o banco traga apenas a pergunta necessária rapidamente, sem pesar o sistema.**  
**SELECT enunciado, resposta FROM TB\_PERGUNTA WHERE id\_categoria \= 2 ORDER BY RANDOM() LIMIT 1;**

| RNF04 | Segurança | O sistema deve ter controle de acesso (login): Mediadores acessam apenas a operação do jogo; apenas Administradores acessam o painel de edição de perguntas e escolas. |
| :---- | :---- | :---- |

**RNF04 \- Controle de Acesso e Perfis (Login)**

**O que é: Uma barreira de segurança inicial (tela de login com usuário e senha) que identifica quem está usando o sistema e restringe quais telas aquela pessoa pode abrir, separando o acesso dos alunos (Mediadores) do acesso dos professores (Administradores).Categoria: Segurança.**

**Por que é necessário: Para proteger os dados do jogo. Durante o evento, muitos alunos vão mexer nos tablets e notebooks. O controle de perfis garante que os Aprendizes Mediadores foquem apenas em operar o jogo e registrar visitantes, evitando que alguém apague o banco de perguntas sem querer, cadastre escolas com nomes errados ou manipule as quantidades do estoque de brindes de forma indevida.**

**Regras de Funcionamento (Como testar):**

* **Perfil Mediador: Quando um aluno fizer login, ele só deve enxergar os menus de "Recepção", "Nova Partida" e "Estoque de Brindes".**  
* **Perfil Administrador: Quando o professor fizer login, o sistema libera um menu extra chamado "Painel Admin", onde é possível inserir/apagar Perguntas (RF10) e cadastrar as Escolas (RF02).**  
* **Bloqueio de Link (URL): Se um Mediador tentar ser "esperto" e digitar o link da área do Administrador direto na barra de endereços do navegador (ex: `/admin/perguntas`), o sistema deve bloquear o acesso e exibir a mensagem: *"Acesso Negado: Você não tem permissão para visualizar esta página"*.**

**\-- Exemplo de consulta no banco na hora que o usuário clica em "Entrar"**

**SELECT nome, perfil** 

**FROM TB\_USUARIO** 

**WHERE email \= 'professor@senai.com.br' AND senha \= 'senha\_criptografada';**

| RNF05 | Portabilidade | O sistema deve ser acessível via navegadores web padrão (Google Chrome, Firefox, Edge) sem a necessidade de instalação de aplicativos no dispositivo. |
| :---- | :---- | :---- |

**RNF05 \- Acesso via Navegador Web (Sem Instalação)**

**O que é: O sistema será uma aplicação web (como um site normal), acessado por um link (URL), em vez de ser um aplicativo de celular ou um programa de computador (.exe) que precisa ser baixado e instalado na máquina.Categoria: Portabilidade.**

**Por que é necessário: No dia do evento Mundo SENAI, os equipamentos (tablets, notebooks ou computadores) podem ser trocados de última hora ou vir de diferentes laboratórios. Se fosse um programa de instalar, daria muito trabalho para a equipe de TI configurar cada máquina. Sendo uma plataforma web, basta abrir o navegador de internet, digitar o endereço e o sistema já está pronto para uso na mesma hora.**

**Regras de Funcionamento (Como testar):**

* **Compatibilidade Padrão: O layout e as funções (cliques, sorteios) devem funcionar perfeitamente nos navegadores mais populares do mercado: Google Chrome, Mozilla Firefox, Microsoft Edge e Apple Safari (se usarem iPads).**  
* **Zero Instalação: O sistema não deve exigir que o usuário baixe nenhum plugin ou extensão extra para o jogo rodar.**  
* **Independência de Sistema Operacional: Como roda direto no navegador, o sistema tem que funcionar igual se o computador for Windows, Linux (comum em laboratórios de TI) ou se o tablet for Android.**

**\<\!-- O sistema será construído usando a trindade padrão da Web,**   
**dispensando arquivos de instalação específicos do Windows ou Android \--\>**  
**\- HTML5 (Para a estrutura das páginas e textos)**  
**\- CSS3 (Para o layout, cores, responsividade do RNF01)**  
**\- JavaScript (Para fazer as ações rápidas de botão e sorteio do RNF03)**

| RNF06 | Confiabilidade | O banco de dados deve garantir a integridade das informações da partida, não perdendo a pontuação atual dos jogadores caso a página seja atualizada sem querer. |
| :---- | :---- | :---- |

**RNF06 \- Integridade de Dados e Recuperação de Partida**

**O que é: O sistema deve salvar cada passo do jogo imediatamente de forma segura. Se a internet cair, a bateria do tablet acabar ou o mediador atualizar a página sem querer (apertar "F5"), o jogo não recomeça do zero e as posições de todos os jogadores no tabuleiro são mantidas.Categoria: Confiabilidade.**

**Por que é necessário: No meio da agitação do evento, esbarrar no botão de recarregar a página ou perder o sinal do Wi-Fi por alguns segundos é muito comum. Como os jogadores reais estão andando sobre um tabuleiro gigante, seria frustrante e desorganizaria toda a fila se o sistema perdesse a contagem e eles tivessem que recomeçar a rodada. O sistema digital deve refletir a realidade física o tempo todo.**

**Regras de Funcionamento (Como testar):**

* **Salvamento Instantâneo: Toda ação importante (como registrar o valor do dado ou confirmar se o jogador acertou a pergunta) deve ser gravada no banco de dados na mesma hora, e não apenas no final da partida.**  
* **Retomada de onde parou: Se a página for atualizada ou fechada acidentalmente, ao acessar o menu "Partida em Andamento", a tela deve carregar exatamente na vez do jogador atual e com a pontuação/casa onde cada um parou.**

**\-- O sistema recupera a situação da partida contando o histórico de jogadas salvas no banco.**  
**\-- Exemplo: Consultando a última casa registrada do jogador para saber onde o peão dele está agora, mesmo após atualizar a página.**  
**SELECT casa\_final**   
**FROM TB\_JOGADA**   
**WHERE id\_partida \= 1 AND id\_jogador \= 2**   
**ORDER BY id\_jogada DESC**   
**LIMIT 1;**

 

# 

**Descrição dos perfis de usuários e suas permissões.**

Coordenação e Supervisão (Perfil Administrador) 

**Quem assume:** Prof. Carlos Alexandre dos Santos e a equipe de Supervisão de Unidade do SENAI Videira.  
**Papel:** Responsáveis pelo alinhamento pedagógico, liberação de recursos e avaliação geral do projeto.

## 

## O que pode fazer: 

* Aprovar compras de materiais, insumos e o orçamento do evento.  
* Revisar e aprovar o banco de perguntas e cartas temáticas criadas pela turma.  
* Alterar regras, dinâmicas ou a estrutura geral da atividade.  
* Avaliar o desempenho dos alunos de Assistente Administrativo nas competências da disciplina.  
* Acompanhar os relatórios de participação das escolas e resultados do evento.


# Turma de Assistente Administrativo (Perfil Mediador / Operador) 

**Quem assume:** Alunos da turma de Aprendizagem Industrial do turno vespertino.  
**Papel:** Tocar toda a operação prática, desde a montagem das cartas até a condução do jogo no tablado.

## O que pode fazer: 

* Escrever e organizar o banco de perguntas e os 4 baralhos de desafios.  
* Fazer a recepção e o cadastro das turmas de visitantes.  
* Iniciar, pausar e controlar o tempo de cada partida.  
* Ler os desafios, conferir as respostas e dar o veredito sobre o avanço no tabuleiro.  
* Registrar as pontuações e distribuir os chaveiros ao final de cada rodada.  
* Cuidar dos equipamentos (projetor, mesas, preservação do tabuleiro de MDF).

# Estudantes Visitantes (Perfil Jogador / Peão Humano) 

**Quem assume:** Alunos do 6º ano do Fundamental ao 3º ano do Médio das escolas da região e turmas do SENAI.  
**Papel:** Vivenciar a experiência do jogo atuando diretamente no tabuleiro.

## O que pode fazer: 

* Lançar os dados gigantes de espuma na sua vez de jogar.  
* Responder às cartas de perguntas e encarar os desafios sorteados.  
* Deslocar-se pelas casas do tabuleiro conforme o resultado.  
* Receber o chaveiro correspondente ao nível alcançado no final do percurso.


# Público do Mundo SENAI e Acompanhantes (Perfil Espectador) 

**Quem assume:** Professores das escolas parceiras, pais e visitantes em geral.  
**Papel:** Acompanhar a movimentação da atividade sem interferir no andamento.

## O que pode fazer: 

* Assistir às partidas da área delimitada para a plateia e ver os slides no DataShow.  
* Pegar materiais informativos sobre os cursos e a estrutura da unidade SENAI.