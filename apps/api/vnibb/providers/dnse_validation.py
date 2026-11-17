def integer(value: object, field: str, bits: int = 64) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not -(2 ** (bits - 1)) <= value < 2 ** (bits - 1):
        raise ValueError(f"Malformed DNSE {field}")
    return value


def symbol(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Malformed DNSE symbol")
    return value.strip().upper()
