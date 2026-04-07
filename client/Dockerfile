FROM node:20-alpine as build
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /usr/src/app/dist ./dist
RUN npm install -g serve
EXPOSE $PORT
CMD ["sh", "-c", "serve -s dist -l ${PORT}"]