import httpx


def main():
    with httpx.Client(timeout=130.0, trust_env=False) as client:
        response = client.post(
            "http://127.0.0.1:8000/extract-report",
            json={
                "transcript": (
                    "Caller: Our machine RP-204 displays E204. "
                    "Restarting did not help."
                ),
            },
        )

    print(response.status_code)
    print(response.json())
    response.raise_for_status()


if __name__ == "__main__":
    main()
