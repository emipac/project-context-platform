FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1

COPY pyproject.toml ./
RUN pip install --no-cache-dir .
COPY *.py ./

EXPOSE 8091
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8091"]
