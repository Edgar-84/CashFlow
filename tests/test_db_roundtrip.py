import asyncpg
import pytest
from factories import make_account, make_category, make_expense, make_user


@pytest.mark.integration
async def test_expense_round_trip(db_conn: asyncpg.Connection) -> None:
    account_id = await make_account(db_conn)
    category_id = await make_category(db_conn, account_id=account_id)
    user = await make_user(db_conn, account_id=account_id)

    expense = await make_expense(
        db_conn,
        account_id=account_id,
        user_id=user.id,
        category_id=category_id,
        amount=1500,
        comment="coffee",
    )

    row = await db_conn.fetchrow(
        "SELECT amount, comment, category_id, user_id, account_id FROM expenses WHERE id = $1",
        expense.id,
    )

    assert row is not None
    assert row["amount"] == 1500
    assert row["comment"] == "coffee"
    assert row["category_id"] == category_id
    assert row["user_id"] == user.id
    assert row["account_id"] == account_id
