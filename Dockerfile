FROM node:20-bookworm-slim
WORKDIR /tulkka-backend
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=8000
EXPOSE 8000
CMD [ "npm","start" ]