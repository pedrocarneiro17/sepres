"""Cria ou atualiza um usuário do sistema.

Uso:
    python criar_usuario.py <usuario> <email> <senha>

Para o banco de produção (Railway), rode com a DATABASE_URL de lá, por ex.:
    railway run python criar_usuario.py maria maria@empresa.com SenhaForte123
Se o usuário já existir, e-mail e senha são atualizados.
"""
import sys
from app import app, db, Usuario


def main():
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(1)
    username, email, senha = sys.argv[1:]
    with app.app_context():
        usuario = Usuario.query.filter_by(username=username).first()
        criado = usuario is None
        if criado:
            usuario = Usuario(username=username)
            db.session.add(usuario)
        usuario.email = email
        usuario.definir_senha(senha)
        db.session.commit()
        print(f'Usuário "{username}" {"criado" if criado else "atualizado"}.')


if __name__ == '__main__':
    main()
